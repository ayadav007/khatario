import { NextResponse } from 'next/server';
import { disconnectWhatsApp } from '@/lib/whatsapp';
import { withWhatsAppBaseApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

export const POST = withWhatsAppBaseApi({ parseJsonBody: true }, async ({ businessId }) => {
  try {
    await disconnectWhatsApp(businessId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[WA] Error disconnecting:', error);
    return NextResponse.json({ error: error.message || 'Failed to disconnect' }, { status: 500 });
  }
});
