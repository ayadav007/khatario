import { NextRequest, NextResponse } from 'next/server';
import { syncWhatsAppMessages } from '@/lib/whatsapp';
import { hasWhatsAppBotAddon } from '@/lib/subscription';

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

    // Check if business has WhatsApp Bot addon
    const hasAddon = await hasWhatsAppBotAddon(business_id);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
        { status: 403 }
      );
    }

    // Trigger message sync
    const result = await syncWhatsAppMessages(business_id);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: result.message
      });
    } else {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

  } catch (error: any) {
    console.error('[WA] Error syncing messages:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync messages' },
      { status: 500 }
    );
  }
}

