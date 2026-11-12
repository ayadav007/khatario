import { NextResponse } from 'next/server';
import { Readable } from 'stream';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { WaMediaGoneError, openWaMedia, verifyWaMediaRefUrl } from '@/lib/whatsapp/media-ref-server';

export const dynamic = 'force-dynamic';

/**
 * WhatsApp media by link: fetched from WhatsApp (or Meta) when opened and streamed through,
 * never written to disk. The web inbox normally decrypts in the browser instead; this serves
 * the phone app, exports and the browser's fallback. Only signed links are honoured, and Cloud
 * API files are fetched with the signed-in business's own token.
 */
export const GET = withWhatsAppPremiumApi({ inboxPermission: true }, async ({ request, businessId }) => {
  const url = new URL(request.url);
  const ref = verifyWaMediaRefUrl(`${url.pathname}${url.search}`);
  if (!ref) return NextResponse.json({ error: 'Invalid media link' }, { status: 400 });

  try {
    const file = await openWaMedia(businessId, ref);
    const mimeType = file.mimeType.split(';')[0].trim() || 'application/octet-stream';
    const inline = /^(image|video|audio)\//.test(mimeType) || mimeType === 'application/pdf';
    const fileName = (ref.f || `whatsapp-${ref.t}`).replace(/["\\\r\n]/g, '_');
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      // The link never changes what it points to, so the device may keep it.
      'Cache-Control': 'private, max-age=2592000, immutable',
      'Content-Disposition': inline ? 'inline' : `attachment; filename="${fileName}"`,
      'X-Content-Type-Options': 'nosniff',
    };
    if (file.size) headers['Content-Length'] = String(file.size);
    return new NextResponse(Readable.toWeb(file.stream) as unknown as ReadableStream, { status: 200, headers });
  } catch (err) {
    if (err instanceof WaMediaGoneError) {
      return NextResponse.json({ error: 'This file is no longer available on WhatsApp. Open it on the phone.' }, { status: 410 });
    }
    console.error('[WA media] stream failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Could not load media' }, { status: 502 });
  }
});
