import { NextResponse } from 'next/server';
import { getWhatsAppStatus } from '@/lib/whatsapp';
import { isMetaWaConfigured } from '@/lib/meta-whatsapp-credentials';
import { withWhatsAppBaseApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

export const GET = withWhatsAppBaseApi({}, async ({ businessId }) => {
  try {
    const [status, cloudReady] = await Promise.all([
      getWhatsAppStatus(businessId),
      isMetaWaConfigured(businessId).catch(() => false),
    ]);
    return NextResponse.json({ ...status, cloudReady });
  } catch (error: any) {
    console.error('[WA] Error fetching status:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch status' }, { status: 500 });
  }
});
