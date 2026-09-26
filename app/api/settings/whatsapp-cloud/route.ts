import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  loadBusinessMetaWaSecrets,
  saveBusinessMetaWaCredentials,
  toPublicMetaWaCredentials,
} from '@/lib/meta-whatsapp-credentials';

export const dynamic = 'force-dynamic';

async function resolveBusinessId(request: NextRequest, body?: { business_id?: string }) {
  const userId = getUserIdFromRequest(request, body);
  if (!userId) return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  const user = await queryOne<{ business_id: string | null }>(
    'SELECT business_id FROM users WHERE id = $1',
    [userId],
  );
  if (!user?.business_id) {
    return { error: NextResponse.json({ error: 'No business' }, { status: 400 }) };
  }
  return { userId, businessId: user.business_id };
}

export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;
    const resolved = await resolveBusinessId(request);
    if ('error' in resolved) return resolved.error;
    await authorize(resolved.userId, 'settings', 'read', { businessId: resolved.businessId });
    const secrets = await loadBusinessMetaWaSecrets(resolved.businessId);
    const origin = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    return NextResponse.json({
      credentials: toPublicMetaWaCredentials(secrets),
      webhook_url: `${origin}/api/webhooks/meta-whatsapp?business_id=${resolved.businessId}`,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load Cloud API settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;
    const body = await request.json();
    const resolved = await resolveBusinessId(request, body);
    if ('error' in resolved) return resolved.error;
    await authorize(resolved.userId, 'settings', 'update', { businessId: resolved.businessId });
    const credentials = await saveBusinessMetaWaCredentials(resolved.businessId, {
      waba_id: String(body.waba_id || ''),
      phone_number_id: String(body.phone_number_id || ''),
      access_token: body.access_token,
      app_secret: body.app_secret,
      verify_token: body.verify_token,
    });
    return NextResponse.json({ credentials });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : String(error);
    const status = /SECRETS_ENCRYPTION_KEY|PAYMENT_ENCRYPTION_KEY/.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
