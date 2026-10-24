import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { logAdminAction } from '@/lib/platform-auth';
import {
  loadPlatformPaymentSecrets,
  PlatformPaymentSettingsError,
  savePlatformPaymentSettings,
  toPublicPlatformPaymentSettings,
} from '@/lib/platform-payment-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;
  const settings = toPublicPlatformPaymentSettings(await loadPlatformPaymentSecrets());
  return NextResponse.json({ settings });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const before = await loadPlatformPaymentSecrets();
    const settings = await savePlatformPaymentSettings({
      active_provider: body.active_provider,
      razorpay: (body.razorpay ?? {}) as Record<string, unknown>,
      easebuzz: (body.easebuzz ?? {}) as Record<string, unknown>,
    });

    const rzp = (body.razorpay ?? {}) as Record<string, unknown>;
    const eb = (body.easebuzz ?? {}) as Record<string, unknown>;
    await logAdminAction(
      auth.admin.id,
      'update_platform_payment_settings',
      'platform_settings',
      'default',
      {
        previous_provider: before.activeProvider,
        active_provider: settings.active_provider,
        razorpay_key_id_changed: Boolean(rzp.key_id),
        razorpay_key_secret_changed: Boolean(rzp.key_secret),
        razorpay_webhook_secret_changed: Boolean(rzp.webhook_secret),
        easebuzz_key_changed: Boolean(eb.key),
        easebuzz_salt_changed: Boolean(eb.salt),
        easebuzz_environment: settings.easebuzz.environment,
      },
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return NextResponse.json({ settings });
  } catch (error: unknown) {
    if (error instanceof PlatformPaymentSettingsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/SECRETS_ENCRYPTION_KEY|PAYMENT_ENCRYPTION_KEY/.test(message)) {
      return NextResponse.json(
        { error: 'Server encryption key is not configured (SECRETS_ENCRYPTION_KEY).' },
        { status: 503 },
      );
    }
    console.error('[admin/platform-payments] save failed');
    return NextResponse.json({ error: 'Could not save payment settings' }, { status: 500 });
  }
}
