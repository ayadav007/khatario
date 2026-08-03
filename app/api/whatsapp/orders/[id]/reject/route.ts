import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/whatsapp/orders/[id]/reject
 * Reject WhatsApp order and notify customer
 */
export const POST = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true },
  async ({ params, body, businessId }) => {
    const orderId = params.id;

    try {
      const { reason } = (body ?? {}) as { reason?: string };

      await query(
        `UPDATE sales_orders 
       SET status = 'cancelled', 
           notes = $1,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 AND business_id = $3`,
        [reason || 'Payment could not be verified', orderId, businessId],
      );

      return NextResponse.json({ success: true, message: 'Order rejected' });
    } catch (error: any) {
      console.error('Error rejecting WhatsApp order:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
