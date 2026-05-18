import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppStatus } from '@/lib/whatsapp';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('business_id');

  if (!businessId) {
    return NextResponse.json({ error: 'Business ID is required' }, { status: 400 });
  }

  try {
    const status = await getWhatsAppStatus(businessId);
    return NextResponse.json(status);
  } catch (error: any) {
    console.error('[WA] Error fetching status:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch status' }, { status: 500 });
  }
}
