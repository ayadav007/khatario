import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query, getPool } from '@/lib/db';

/**
 * GET /api/whatsapp/orders
 * Fetch sales orders placed via WhatsApp that need verification
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const status = searchParams.get('status') || 'draft'; // pending verification

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Fetch orders with WhatsApp context and OCR data
    // Only include orders that have a whatsapp_conversation_id
    const orders = await queryRows(`
      SELECT 
        so.*,
        c.name as customer_name,
        c.phone as customer_phone,
        wc.from_number as whatsapp_phone
      FROM sales_orders so
      LEFT JOIN customers c ON so.customer_id = c.id
      LEFT JOIN whatsapp_conversations wc ON so.whatsapp_conversation_id = wc.id
      WHERE so.business_id = $1 
      AND so.whatsapp_conversation_id IS NOT NULL
      ${status ? 'AND so.status = $2' : ''}
      ORDER BY so.created_at DESC
    `, status ? [businessId, status] : [businessId]);

    // Fetch items for each order
    const ordersWithItems = await Promise.all(orders.map(async (order) => {
      const items = await queryRows(
        'SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY sort_order ASC',
        [order.id]
      );
      return { ...order, items };
    }));

    return NextResponse.json({ orders: ordersWithItems });
  } catch (error: any) {
    console.error('Error fetching WhatsApp orders:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
