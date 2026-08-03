import { NextResponse } from 'next/server';
import { getWhatsAppSocket } from '@/lib/whatsapp';
import { withWhatsAppBaseApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

export const POST = withWhatsAppBaseApi({ parseJsonBody: true }, async ({ businessId }) => {
  try {
    let session = await getWhatsAppSocket(businessId);

    if (session.status === 'disconnected' || session.status === 'pending_qr') {
      let retries = 0;
      const maxRetries = 20;

      while (!session.qr && retries < maxRetries && session.status !== 'connected') {
        await new Promise((r) => setTimeout(r, 500));
        retries++;

        try {
          session = await getWhatsAppSocket(businessId);
          if (session.qr || session.status === 'connected') {
            return NextResponse.json({
              status: session.status,
              qr: session.qr || null,
              phoneNumber: session.phoneNumber || null,
            });
          }
        } catch (err) {
          console.error('[WA] Error re-checking session:', err);
        }
      }

      if (!session.qr && session.status === 'pending_qr') {
        console.warn(`[WA] QR code not generated after ${maxRetries * 500}ms for ${businessId}`);
      }
    }

    return NextResponse.json({
      status: session.status,
      qr: session.qr || null,
      phoneNumber: session.phoneNumber || null,
    });
  } catch (error: any) {
    console.error('[WA] Error generating QR:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate QR code' }, { status: 500 });
  }
});
