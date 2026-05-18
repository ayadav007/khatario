import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import { listBusinessPaymentProviderIds } from '@/lib/payments/business-provider-config';

/**
 * GET /api/settings/payments
 * Returns payments-related preferences stored on business_settings.
 */
export async function GET(request: NextRequest) {
  try {
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    await authorize(userId, 'settings', 'read', { businessId });

    const columnExists = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_name = 'business_settings'
           AND column_name = 'default_payment_provider'
       ) as exists`
    );
    if (!columnExists?.exists) {
      return NextResponse.json({ default_payment_provider: null });
    }

    const row = await queryOne<{ default_payment_provider: string | null }>(
      `SELECT default_payment_provider
       FROM business_settings
       WHERE business_id = $1`,
      [businessId]
    );
    return NextResponse.json({
      default_payment_provider: row?.default_payment_provider ?? null,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    console.error('[settings/payments GET]', error);
    return NextResponse.json({ error: 'Failed to load payments settings' }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/payments
 * Body: { default_payment_provider: string | null }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const businessId =
      getSessionScopedBusinessId(request) ??
      getBusinessIdFromRequest(request, body);
    const userId = getUserIdFromRequest(request, body);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    await authorize(userId, 'settings', 'update', { businessId });

    const columnExists = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_name = 'business_settings'
           AND column_name = 'default_payment_provider'
       ) as exists`
    );
    if (!columnExists?.exists) {
      return NextResponse.json(
        {
          error:
            'Settings column not found. Please run migration 224_business_settings_default_payment_provider.sql',
        },
        { status: 500 }
      );
    }

    const raw = body?.default_payment_provider;
    const next =
      raw == null
        ? null
        : typeof raw === 'string'
          ? raw.trim().toLowerCase() || null
          : null;

    if (next) {
      const configured = await listBusinessPaymentProviderIds(businessId);
      const ok = configured.some((r) => r.provider.toLowerCase() === next);
      if (!ok) {
        return NextResponse.json(
          { error: 'Selected provider is not configured for this business' },
          { status: 422 }
        );
      }
    }

    const row = await queryOne<{ default_payment_provider: string | null }>(
      `INSERT INTO business_settings (business_id, default_payment_provider)
       VALUES ($1, $2)
       ON CONFLICT (business_id) DO UPDATE
       SET default_payment_provider = EXCLUDED.default_payment_provider,
           updated_at = CURRENT_TIMESTAMP
       RETURNING default_payment_provider`,
      [businessId, next]
    );

    return NextResponse.json({
      default_payment_provider: row?.default_payment_provider ?? null,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    console.error('[settings/payments PATCH]', error);
    return NextResponse.json({ error: 'Failed to save payments settings' }, { status: 500 });
  }
}

