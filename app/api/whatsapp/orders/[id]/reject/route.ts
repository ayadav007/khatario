import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';

/**
 * POST /api/whatsapp/orders/[id]/reject
 * Reject WhatsApp order and notify customer
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const orderId = params.id;

  try {
    const { business_id, reason } = await request.json();

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Update order status
    await query(
      `UPDATE sales_orders 
       SET status = 'cancelled', 
           notes = $1,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 AND business_id = $3`,
      [reason || 'Payment could not be verified', orderId, business_id]
    );

    // Notify customer via WhatsApp (should be done in background)
    // ...

    return NextResponse.json({ success: true, message: 'Order rejected' });

  } catch (error: any) {
    console.error('Error rejecting WhatsApp order:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
