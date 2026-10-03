import { NextRequest, NextResponse } from 'next/server';
import {
  extractInboundMessages,
  extractTemplateStatusUpdates,
  metaWaWebhookChallenge,
  verifyMetaWaWebhookSignature,
} from '@/lib/meta-whatsapp';
import { applyWebhookTemplateStatus } from '@/lib/platform-whatsapp-templates';
import { loadBusinessMetaWaSecrets, loadPlatformMetaWaSecrets } from '@/lib/meta-whatsapp-credentials';
import { addWhatsAppMessageJob } from '@/lib/queue';
import { recordInbound, routeCloudInbound } from '@/lib/whatsapp/inbound-router';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('business_id')?.trim();
  if (businessId && !UUID_RE.test(businessId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // '' (not null) for tenants, so a missing tenant token never falls back to the platform env token.
  const token = businessId
    ? (await loadBusinessMetaWaSecrets(businessId)).verifyToken || ''
    : (await loadPlatformMetaWaSecrets()).verifyToken;
  const challenge = metaWaWebhookChallenge(request.nextUrl.searchParams, token);
  if (!challenge) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

async function handleTenant(businessId: string, body: unknown) {
  const { applyTenantTemplateStatus } = await import('@/lib/whatsapp/owner-summary');
  const { applyBusinessTemplateWebhook } = await import('@/lib/whatsapp/tenant-templates');
  for (const update of extractTemplateStatusUpdates(body)) {
    await applyTenantTemplateStatus(businessId, update).catch(() => undefined);
    await applyBusinessTemplateWebhook(businessId, update).catch(() => undefined);
  }
  const messages = extractInboundMessages(body);
  for (const m of messages) {
    const route = await routeCloudInbound({
      businessId,
      businessPhone: m.displayPhoneNumber,
      messageId: m.messageId,
      from: m.from,
      text: m.text,
    });
    if (route !== 'other' || !m.text) continue;
    await addWhatsAppMessageJob({
      type: 'cloud-incoming',
      businessId,
      messageId: m.messageId,
      conversationId: m.from,
      timestamp: Date.now(),
      from: m.from,
      profileName: m.profileName,
      text: m.text,
      messageType: m.type,
      businessPhone: (m.displayPhoneNumber || '').replace(/\D/g, ''),
      sourceTimestampSec: m.timestamp,
    });
  }
  return messages.length;
}

async function handlePlatformMessages(body: unknown) {
  const messages = extractInboundMessages(body);
  for (const m of messages) {
    if (!m.text) continue;
    const fresh = await recordInbound({
      provider: 'platform',
      businessId: null,
      messageId: m.messageId,
      senderPhone: m.from,
      handledAs: 'assistant',
    });
    if (!fresh) continue;
    await addWhatsAppMessageJob({
      type: 'platform-incoming',
      businessId: 'platform',
      messageId: m.messageId,
      conversationId: m.from,
      timestamp: Date.now(),
      from: m.from,
      profileName: m.profileName,
      text: m.text,
    });
  }
  return messages.length;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  const businessId = request.nextUrl.searchParams.get('business_id')?.trim() || null;
  if (businessId && !UUID_RE.test(businessId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A tenant webhook must carry the tenant's own signature; '' (not null) stops the verifier
  // falling back to the platform env secret when the tenant has none saved.
  const secret = businessId
    ? (await loadBusinessMetaWaSecrets(businessId)).appSecret || ''
    : (await loadPlatformMetaWaSecrets()).appSecret;
  if (!verifyMetaWaWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    if (businessId) {
      const messages = await handleTenant(businessId, body);
      return NextResponse.json({ ok: true, messages });
    }
    const updates = extractTemplateStatusUpdates(body);
    for (const update of updates) {
      await applyWebhookTemplateStatus(update);
    }
    const messages = await handlePlatformMessages(body);
    return NextResponse.json({ ok: true, updates: updates.length, messages });
  } catch (err) {
    // Meta retries non-2xx for days; message ids are de-duplicated, so log and acknowledge.
    console.error('[meta-whatsapp webhook] processing failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, error: 'processing_failed' });
  }
}
