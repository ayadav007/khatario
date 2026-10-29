export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/leads/:token - a business's inbound lead webhook (Zapier, Make, JustDial, ad forms).
 * The token in the URL is the only credential and picks the business; nothing in the body can.
 * Body (JSON or form): phone (required), name, message, id (to drop repeats), email, city, product, source.
 * Each new lead goes on the pipeline; its chat links when the buyer messages (a number with an open lead joins it).
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { LeadSourceError, receiveWebhookLead } from '@/lib/whatsapp/lead-sources';

const LIMIT_PER_MINUTE = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> | { token: string } }) {
  const { token } = await params;
  const rl = checkRateLimit(`lead-webhook:${token.slice(0, 16)}`, LIMIT_PER_MINUTE, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many leads in a minute' }, { status: 429 });

  let body: unknown = null;
  const type = request.headers.get('content-type') || '';
  try {
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      body = Object.fromEntries((await request.formData()).entries());
    } else {
      body = await request.json();
    }
  } catch {
    return NextResponse.json({ error: 'Send the lead as JSON' }, { status: 400 });
  }

  try {
    const result = await receiveWebhookLead(token, body);
    return NextResponse.json({ ok: true, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
  } catch (error: any) {
    if (error instanceof LeadSourceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[lead webhook] error:', error);
    return NextResponse.json({ error: 'Could not save the lead' }, { status: 500 });
  }
}
