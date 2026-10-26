/**
 * GET /w/:code[?via=qr|widget] - public short link for a Connect tracked link.
 * Counts the click and sends the visitor to WhatsApp with the message (and its "(ref CODE)") pre-filled.
 */
import { NextRequest, NextResponse } from 'next/server';
import { openEntryLink, type LinkVia } from '@/lib/whatsapp/lead-sources';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> | { code: string } }) {
  const { code } = await params;
  const v = request.nextUrl.searchParams.get('via');
  const via: LinkVia = v === 'qr' || v === 'widget' ? v : 'link';
  const target = await openEntryLink(code, via).catch(() => null);
  if (!target) {
    return new NextResponse('This WhatsApp link is no longer active.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return NextResponse.redirect(target, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
