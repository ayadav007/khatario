import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getBusinessEmailConfigRow,
  saveBusinessEmailConfig,
  toPublicConfig,
  verifyBusinessEmailConfig,
} from '@/lib/business-email';

async function resolveBusinessId(request: NextRequest, body?: { business_id?: string }) {
  const userId = getUserIdFromRequest(request, body);
  if (!userId) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };

  const user = await queryOne<{ business_id: string | null }>(
    'SELECT business_id FROM users WHERE id = $1',
    [userId]
  );
  if (!user?.business_id) {
    return { error: NextResponse.json({ error: 'No business' }, { status: 400 }) };
  }

  return { userId, businessId: user.business_id };
}

/**
 * GET /api/settings/email?business_id=...
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const resolved = await resolveBusinessId(request);
    if ('error' in resolved) return resolved.error;
    const { userId, businessId } = resolved;

    await authorize(userId, 'settings', 'read', { businessId });

    const row = await getBusinessEmailConfigRow(businessId);
    const business = await queryOne<{ email: string | null; name: string | null }>(
      'SELECT email, name FROM businesses WHERE id = $1',
      [businessId]
    );

    return NextResponse.json({
      config: toPublicConfig(row),
      defaults: {
        from_email: business?.email ?? '',
        from_name: business?.name ?? '',
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('settings/email GET:', error);
    return NextResponse.json({ error: 'Failed to load email settings' }, { status: 500 });
  }
}

/**
 * PUT /api/settings/email
 */
export async function PUT(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const body = await request.json();
    const resolved = await resolveBusinessId(request, body);
    if ('error' in resolved) return resolved.error;
    const { userId, businessId } = resolved;

    await authorize(userId, 'settings', 'update', { businessId });

    const {
      enabled,
      smtp_host,
      smtp_port,
      smtp_secure,
      smtp_user,
      smtp_password,
      from_email,
      from_name,
      reply_to_email,
    } = body;

    if (!from_email?.trim()) {
      return NextResponse.json({ error: 'From email is required' }, { status: 400 });
    }

    await saveBusinessEmailConfig(businessId, {
      enabled: Boolean(enabled),
      smtp_host: smtp_host?.trim() || 'smtp.gmail.com',
      smtp_port: Number(smtp_port) || 587,
      smtp_secure: Boolean(smtp_secure),
      smtp_user: smtp_user?.trim() || '',
      smtp_password: typeof smtp_password === 'string' ? smtp_password : undefined,
      from_email: from_email.trim(),
      from_name: from_name?.trim() || null,
      reply_to_email: reply_to_email?.trim() || null,
    });

    const row = await getBusinessEmailConfigRow(businessId);
    return NextResponse.json({ success: true, config: toPublicConfig(row) });
  } catch (error: unknown) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const msg = error instanceof Error ? error.message : 'Failed to save email settings';
    console.error('settings/email PUT:', error);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/**
 * POST /api/settings/email/test
 * Body: { test_recipient?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const body = await request.json().catch(() => ({}));
    const resolved = await resolveBusinessId(request, body);
    if ('error' in resolved) return resolved.error;
    const { userId, businessId } = resolved;

    await authorize(userId, 'settings', 'update', { businessId });

    const result = await verifyBusinessEmailConfig(
      businessId,
      typeof body.test_recipient === 'string' ? body.test_recipient : undefined
    );

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('settings/email test:', error);
    return NextResponse.json({ error: 'Test failed' }, { status: 500 });
  }
}
