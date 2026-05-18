import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import {
  getBusinessPaymentProviderConfig,
  listBusinessPaymentProviderIds,
  upsertBusinessPaymentProviderConfig,
} from '@/lib/payments/business-provider-config';
import {
  getSupportedPaymentProviderCatalog,
  isKnownPaymentProviderId,
  isSupportedPaymentProviderId,
} from '@/lib/payment-providers-catalog';

function maskClientId(plain: string): string {
  const s = String(plain || '').trim();
  if (!s) return '';
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 3)}••••${s.slice(-4)}`;
}

/**
 * GET /api/settings/payment-providers
 * List configured providers (masked IDs only — never secrets).
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

    try {
      await authorize(userId, 'settings', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const configuredRows = await listBusinessPaymentProviderIds(businessId);
    const envByProvider = new Map(
      configuredRows.map((r) => [r.provider.toLowerCase(), r.environment])
    );

    const catalog = getSupportedPaymentProviderCatalog();
    const providers = await Promise.all(
      catalog.map(async (p) => {
        const key = p.id.toLowerCase();
        const hasRow = envByProvider.has(key);
        if (!hasRow) {
          return {
            ...p,
            configured: false,
            environment: null as string | null,
            client_id_masked: null as string | null,
            secret_configured: false,
          };
        }
        const decrypted = await getBusinessPaymentProviderConfig(businessId, key);
        const cid = decrypted?.clientId?.trim() ?? '';
        const sec = decrypted?.clientSecret?.trim() ?? '';
        return {
          ...p,
          configured: true,
          environment: envByProvider.get(key) ?? decrypted?.environment ?? 'sandbox',
          client_id_masked: cid ? maskClientId(cid) : null,
          secret_configured: sec.length > 0,
        };
      })
    );

    return NextResponse.json({ providers });
  } catch (error: unknown) {
    console.error('[settings/payment-providers GET]', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to load payment providers',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/payment-providers
 * Upsert encrypted credentials for one provider.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const businessId =
      getSessionScopedBusinessId(request) ??
      getBusinessIdFromRequest(request, body);
    const userId = getUserIdFromRequest(request, body);

    const providerRaw = body?.provider;
    const clientIdInput = body?.client_id;
    const clientSecretInput = body?.client_secret;
    const environmentRaw = body?.environment;

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    if (!providerRaw || typeof providerRaw !== 'string') {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    const provider = providerRaw.toLowerCase().trim();
    if (!isKnownPaymentProviderId(provider)) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
    }
    if (!isSupportedPaymentProviderId(provider)) {
      return NextResponse.json(
        { error: 'This payment provider is not available yet' },
        { status: 400 }
      );
    }

    const environment =
      environmentRaw === 'production' ? 'production' : 'sandbox';

    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const existing = await getBusinessPaymentProviderConfig(businessId, provider);

    const nextClientId =
      typeof clientIdInput === 'string' && clientIdInput.trim()
        ? clientIdInput.trim()
        : existing?.clientId?.trim() ?? '';

    const nextSecret =
      typeof clientSecretInput === 'string' && clientSecretInput.trim()
        ? clientSecretInput.trim()
        : existing?.clientSecret?.trim() ?? '';

    if (!nextClientId || !nextSecret) {
      return NextResponse.json(
        {
          error:
            'Client ID and client secret are required. Leave secret blank only when updating an existing secret.',
        },
        { status: 400 }
      );
    }

    const row = await upsertBusinessPaymentProviderConfig({
      businessId,
      provider,
      clientId: nextClientId,
      clientSecret: nextSecret,
      environment,
    });

    return NextResponse.json({
      ok: true,
      provider: row.provider,
      environment: row.environment,
      message: 'Payment provider settings saved.',
    });
  } catch (error: unknown) {
    console.error('[settings/payment-providers POST]', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to save payment provider',
      },
      { status: 500 }
    );
  }
}
