import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { readInboxMedia } from '@/lib/whatsapp/inbox-media';

export const dynamic = 'force-dynamic';

/** Inbox attachment, only for the signed-in business that owns it. */
export const GET = withWhatsAppPremiumApi<{ name: string }>({ inboxPermission: true }, async ({ params, businessId }) => {
  const file = await readInboxMedia(businessId, params.name);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const inline = /^(image|video|audio)\//.test(file.mimeType) || file.mimeType === 'application/pdf';
  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.buffer.length),
      'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': inline ? 'inline' : `attachment; filename="${params.name}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
