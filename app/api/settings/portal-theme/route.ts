import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { mergePortalTheme, normalizePortalThemeJson } from '@/lib/portal-theme';

/**
 * GET /api/settings/portal-theme
 * Effective theme for the signed-in user's business (same shape as session.portalTheme).
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await queryOne<{ business_id: string | null }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userId]
    );
    if (!user?.business_id) {
      return NextResponse.json({ portalTheme: null });
    }

    await authorize(userId, 'settings', 'read', { businessId: user.business_id });

    const bs = await queryOne<{ portal_theme: unknown }>(
      'SELECT portal_theme FROM business_settings WHERE business_id = $1',
      [user.business_id]
    );
    const portalTheme = mergePortalTheme(bs?.portal_theme);
    return NextResponse.json({ portalTheme });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    console.error('portal-theme GET:', error);
    return NextResponse.json({ error: 'Failed to load theme' }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/portal-theme
 * Body: { portal_theme: PortalTheme } | { reset: true }
 */
export async function PATCH(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await queryOne<{ business_id: string | null }>(
      'SELECT business_id FROM users WHERE id = $1',
      [userId]
    );
    if (!user?.business_id) {
      return NextResponse.json({ error: 'No business' }, { status: 400 });
    }

    await authorize(userId, 'settings', 'update', { businessId: user.business_id });

    const body = await request.json();
    if (body?.reset === true) {
      await queryOne(
        `INSERT INTO business_settings (business_id, portal_theme)
         VALUES ($1, NULL)
         ON CONFLICT (business_id) DO UPDATE
         SET portal_theme = NULL, updated_at = CURRENT_TIMESTAMP
         RETURNING portal_theme`,
        [user.business_id]
      );
      const portalTheme = mergePortalTheme(null);
      return NextResponse.json({ portalTheme });
    }

    const parsed = normalizePortalThemeJson(body?.portal_theme);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid portal_theme (need primary_hex as #RGB or #RRGGBB, optional accent_hex, font_preset)' },
        { status: 400 }
      );
    }

    const row = await queryOne<{ portal_theme: unknown }>(
      `INSERT INTO business_settings (business_id, portal_theme)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (business_id) DO UPDATE
       SET portal_theme = EXCLUDED.portal_theme, updated_at = CURRENT_TIMESTAMP
       RETURNING portal_theme`,
      [user.business_id, JSON.stringify(parsed)]
    );

    const portalTheme = mergePortalTheme(row?.portal_theme);
    return NextResponse.json({ portalTheme });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    console.error('portal-theme PATCH:', error);
    return NextResponse.json({ error: 'Failed to save theme' }, { status: 500 });
  }
}
