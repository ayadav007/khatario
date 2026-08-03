export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp/conversations/[id]/linked-orders?business_id=
 */

import { NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const GET = withWhatsAppPremiumApi<{ id: string }>({}, async ({ params, businessId }) => {
  try {
    const conversationUuid = await resolveWhatsAppConversationDbId(businessId, params.id);
    if (!conversationUuid) {
      return NextResponse.json({ invoices: [], orders: [] });
    }

    const conv = await queryOne<{ from_number: string; customer_id: string | null }>(
      `SELECT from_number, customer_id FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [conversationUuid, businessId],
    );
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const phone = conv.from_number?.replace(/\D/g, '') || '';

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
      [businessId, conv.customer_id || null, phone],
    );

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
      [businessId, conversationUuid, conv.customer_id || null, phone],
    );

    return NextResponse.json({ invoices, orders });
  } catch (error: any) {
    console.error('[Linked Orders] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
