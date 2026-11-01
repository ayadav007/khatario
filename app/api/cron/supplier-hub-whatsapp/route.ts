import { NextRequest, NextResponse } from 'next/server';
import { flushHubWhatsApp } from '@/lib/supplier-hub-whatsapp';
import { assertCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/supplier-hub-whatsapp
 * Sends Supplier Hub updates still waiting in the WhatsApp outbox. Hub changes already flush
 * the outbox a few seconds after they commit; this catches anything a restart dropped.
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const stats = await flushHubWhatsApp(200);
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    console.error('Error sending Supplier Hub WhatsApp:', error);
    return NextResponse.json({ error: error.message || 'Failed to send Supplier Hub WhatsApp' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
