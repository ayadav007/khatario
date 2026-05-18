/**
 * GET /api/whatsapp/conversations/[id]/linked-orders?business_id=
 *
 * Returns all invoices + sales orders associated with this conversation,
 * matched either by:
 *   1. Direct FK: sales_orders.whatsapp_conversation_id = conversation.id
 *   2. Phone number: invoice/order customer phone matches conversation.from_number
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Resolve conversation UUID (handles both JID and UUID params)
    const conversationUuid = await resolveWhatsAppConversationDbId(businessId, params.id);
    if (!conversationUuid) {
      // Live-mode-only chat (not yet in DB) — return empty rather than 404
      return NextResponse.json({ invoices: [], orders: [] });
    }

    // Get conversation's phone number for phone-based matching
    const conv = await queryOne<{ from_number: string; customer_id: string | null }>(
      `SELECT from_number, customer_id FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [conversationUuid, businessId]
    );
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const phone = conv.from_number?.replace(/\D/g, '') || '';

    // ── Invoices ──────────────────────────────────────────────────────────────
    // Match by customer_id (if linked) OR customer phone digits
    const invoices = await queryRows(
      `SELECT
         i.id,
         i.invoice_number,
         i.invoice_date,
         i.due_date,
         i.grand_total,
         i.payment_status,
         i.status,
         c.name  AS customer_name,
         c.phone AS customer_phone
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.business_id = $1
         AND (
           ($2::uuid IS NOT NULL AND i.customer_id = $2::uuid)
           OR ($3 <> '' AND REGEXP_REPLACE(COALESCE(c.phone,''), '[^0-9]', '', 'g') = $3)
         )
       ORDER BY i.invoice_date DESC
       LIMIT 20`,
      [businessId, conv.customer_id || null, phone]
    );

    // ── Sales Orders ──────────────────────────────────────────────────────────
    // Match by direct FK OR customer phone
    const orders = await queryRows(
      `SELECT
         so.id,
         so.order_number,
         COALESCE(so.order_date::text, so.created_at::text) AS order_date,
         so.grand_total,
         so.status,
         c.name  AS customer_name,
         c.phone AS customer_phone
       FROM sales_orders so
       LEFT JOIN customers c ON c.id = so.customer_id
       WHERE so.business_id = $1
         AND (
           so.whatsapp_conversation_id = $2
           OR ($3::uuid IS NOT NULL AND so.customer_id = $3::uuid)
           OR ($4 <> '' AND REGEXP_REPLACE(COALESCE(c.phone,''), '[^0-9]', '', 'g') = $4)
         )
       ORDER BY so.created_at DESC
       LIMIT 20`,
      [businessId, conversationUuid, conv.customer_id || null, phone]
    );

    return NextResponse.json({ invoices, orders });
  } catch (error: any) {
    console.error('[Linked Orders] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
