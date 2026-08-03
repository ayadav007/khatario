import { NextResponse } from 'next/server';
import { syncWhatsAppMessages } from '@/lib/whatsapp';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

export const POST = withWhatsAppPremiumApi(
  { parseJsonBody: true },
  async ({ businessId }) => {
    try {
      const result = await syncWhatsAppMessages(businessId);

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
);
