import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  loadPlatformMetaWaSecrets,
  savePlatformMetaWaCredentials,
  toPublicMetaWaCredentials,
} from '@/lib/meta-whatsapp-credentials';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;
  const secrets = await loadPlatformMetaWaSecrets();
  return NextResponse.json({ credentials: toPublicMetaWaCredentials(secrets) });
}

export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'super_admin');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const credentials = await savePlatformMetaWaCredentials({
      waba_id: String(body.waba_id || ''),
      phone_number_id: String(body.phone_number_id || ''),
      access_token: body.access_token,
      app_secret: body.app_secret,
      verify_token: body.verify_token,
    });
    return NextResponse.json({ credentials });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /SECRETS_ENCRYPTION_KEY|PAYMENT_ENCRYPTION_KEY/.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
