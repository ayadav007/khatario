/**
 * Webhook endpoint for receiving incoming WhatsApp messages
 * This is a fallback endpoint if direct socket listening doesn't work
 * Currently, Baileys handles messages via socket events, but this can be used
 * for external webhook integrations
 */

import { NextRequest, NextResponse } from 'next/server';
import { addWhatsAppMessageJob } from '@/lib/queue';
import { createHmac, timingSafeEqual } from 'crypto';

function verifyMetaWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret?.trim()) return false;
  if (!signatureHeader?.trim()) return false;

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;

  try {
    const a = Buffer.from(signatureHeader, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const business_id = body.business_id;
  const from = body.from;
  const message = body.message;
  if (typeof business_id !== 'string' || typeof from !== 'string' || typeof message !== 'string') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!business_id || !from || !message) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const messageId =
    (typeof body.message_id === 'string' && body.message_id) || `webhook_${Date.now()}`;
  const fromDigits = from.replace(/[^0-9]/g, '') || 'unknown';

  void addWhatsAppMessageJob({
    type: 'webhook',
    businessId: business_id,
    messageId: messageId,
    conversationId: fromDigits,
    timestamp: Date.now(),
    body
  }).catch((e) => {
    console.error('[WA] webhook enqueue failed', e);
  });

  return NextResponse.json({ success: true, queued: true }, { status: 200 });
}
