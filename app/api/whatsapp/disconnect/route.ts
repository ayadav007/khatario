import { NextRequest, NextResponse } from 'next/server';
import { disconnectWhatsApp } from '@/lib/whatsapp';

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

    await disconnectWhatsApp(business_id);
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[WA] Error disconnecting:', error);
    return NextResponse.json({ error: error.message || 'Failed to disconnect' }, { status: 500 });
  }
}
