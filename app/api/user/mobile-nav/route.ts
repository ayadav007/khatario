import { NextRequest, NextResponse } from 'next/server';
import { requirePortalSession } from '@/lib/auth-helpers';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { query, queryOne } from '@/lib/db';
import {
  type MobileNavContext,
  validateMobileNavPrefs,
} from '@/lib/mobile-bottom-nav';
import { checkRolePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

type NavUser = {
  business_id: string | null;
  seat_type: string | null;
  is_primary_admin: boolean | null;
  role_id: string | null;
};

async function navContext(userId: string): Promise<{ ctx: MobileNavContext } | { error: string; status: number }> {
  const user = await queryOne<NavUser>(
    `SELECT business_id, seat_type, is_primary_admin, role_id
     FROM users WHERE id = $1`,
    [userId],
  );
  if (!user?.business_id) {
    return { error: 'No business on this account.', status: 400 };
  }

  let canViewInvoices = user.is_primary_admin === true;
  if (!canViewInvoices && user.role_id) {
    const role = await queryOne<{ role_key: string | null }>(
      'SELECT role_key FROM user_roles WHERE id = $1',
      [user.role_id],
    );
    if (role?.role_key === 'primary_admin') canViewInvoices = true;
    else canViewInvoices = await checkRolePermission(user.role_id, 'invoices', 'view');
  }

  const platform = await getBusinessPlatformContext(user.business_id);
  return {
    ctx: {
      modules: platform.enabledModules,
      isConnectAgent: user.seat_type === 'connect',
      canViewInvoices,
    },
  };
}

/**
 * PATCH /api/user/mobile-nav
 * Saves this user's mobile bottom bar, or clears it when `{ reset: true }`.
 */
export async function PATCH(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = request.headers.get('x-authenticated-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    if ((body as { reset?: unknown }).reset === true) {
      await query(
        `UPDATE users SET mobile_nav = NULL, updated_at = NOW() WHERE id = $1`,
        [userId],
      );
      return NextResponse.json({ ok: true, mobile_nav: null });
    }

    const loaded = await navContext(userId);
    if ('error' in loaded) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }

    const checked = validateMobileNavPrefs(loaded.ctx, body as { slotCount?: unknown; middle?: unknown });
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }

    await query(
      `UPDATE users SET mobile_nav = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [userId, JSON.stringify(checked.prefs)],
    );

    return NextResponse.json({ ok: true, mobile_nav: checked.prefs });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '42703') {
      return NextResponse.json(
        { error: 'Navigation preferences are not available yet.' },
        { status: 503 },
      );
    }
    console.error('[PATCH /api/user/mobile-nav]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
