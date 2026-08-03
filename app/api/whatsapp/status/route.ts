import { NextResponse } from 'next/server';
import { getWhatsAppStatus } from '@/lib/whatsapp';
import { withWhatsAppBaseApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

export const GET = withWhatsAppBaseApi({}, async ({ businessId }) => {
  try {
    const status = await getWhatsAppStatus(businessId);
    return NextResponse.json(status);
  } catch (error: any) {
    console.error('[WA] Error fetching status:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch status' }, { status: 500 });
  }
});
