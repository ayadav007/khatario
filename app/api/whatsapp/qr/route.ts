import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppSocket } from '@/lib/whatsapp';

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const { business_id } = body || {};
    if (!business_id) {
      return NextResponse.json({ error: 'Business ID is required' }, { status: 400 });
    }

    // Get or create socket (won't recreate if valid one exists)
    let session = await getWhatsAppSocket(business_id);
    
    // If status is disconnected or we need a new QR, wait a moment for QR generation
    // QR codes are generated asynchronously after socket creation, so we need to wait
    if (session.status === 'disconnected' || session.status === 'pending_qr') {
      // Wait up to 10 seconds (20 retries * 500ms) for QR to appear
      let retries = 0;
      const maxRetries = 20;
      
      while (!session.qr && retries < maxRetries && session.status !== 'connected') {
        await new Promise(r => setTimeout(r, 500));
        retries++;
        
        // Re-check session (it might have updated with QR)
        try {
          session = await getWhatsAppSocket(business_id);
          if (session.qr || session.status === 'connected') {
            return NextResponse.json({
              status: session.status,
              qr: session.qr || null,
              phoneNumber: session.phoneNumber || null
            });
          }
        } catch (err) {
          console.error('[WA] Error re-checking session:', err);
          // Continue waiting
        }
      }
      
      // If we still don't have a QR after waiting, check if there's an error
      if (!session.qr && session.status === 'pending_qr') {
        console.warn(`[WA] QR code not generated after ${maxRetries * 500}ms for ${business_id}`);
      }
    }

    return NextResponse.json({
      status: session.status,
      qr: session.qr || null,
      phoneNumber: session.phoneNumber || null
    });

  } catch (error: any) {
    console.error('[WA] Error generating QR:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate QR code' }, { status: 500 });
  }
}
