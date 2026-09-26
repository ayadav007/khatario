import { NextRequest, NextResponse } from 'next/server';
import {
  extractTemplateStatusUpdates,
  metaWaWebhookChallenge,
  verifyMetaWaWebhookSignature,
} from '@/lib/meta-whatsapp';
import { applyWebhookTemplateStatus } from '@/lib/platform-whatsapp-templates';
import { loadBusinessMetaWaSecrets, loadPlatformMetaWaSecrets } from '@/lib/meta-whatsapp-credentials';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('business_id')?.trim();
  const secrets = businessId
    ? await loadBusinessMetaWaSecrets(businessId)
    : await loadPlatformMetaWaSecrets();
  const challenge = metaWaWebhookChallenge(request.nextUrl.searchParams, secrets.verifyToken);
  if (!challenge) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  const businessId = request.nextUrl.searchParams.get('business_id')?.trim();
  const platform = await loadPlatformMetaWaSecrets();
  const tenant = businessId ? await loadBusinessMetaWaSecrets(businessId) : null;
  const okPlatform = verifyMetaWaWebhookSignature(rawBody, signature, platform.appSecret);
  const okTenant = tenant ? verifyMetaWaWebhookSignature(rawBody, signature, tenant.appSecret) : false;
  if (!okPlatform && !okTenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (okPlatform && !businessId) {
    const updates = extractTemplateStatusUpdates(body);
    for (const update of updates) {
      await applyWebhookTemplateStatus(update);
    }
    return NextResponse.json({ ok: true, updates: updates.length });
  }
  return NextResponse.json({ ok: true, updates: 0 });
}
