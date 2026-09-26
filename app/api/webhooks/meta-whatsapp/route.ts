import { NextRequest, NextResponse } from 'next/server';
import {
  extractTemplateStatusUpdates,
  metaWaWebhookChallenge,
  verifyMetaWaWebhookSignature,
} from '@/lib/meta-whatsapp';
import { applyWebhookTemplateStatus } from '@/lib/platform-whatsapp-templates';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const challenge = metaWaWebhookChallenge(request.nextUrl.searchParams);
  if (!challenge) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  if (!verifyMetaWaWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const updates = extractTemplateStatusUpdates(body);
  for (const update of updates) {
    await applyWebhookTemplateStatus(update);
  }
  return NextResponse.json({ ok: true, updates: updates.length });
}
