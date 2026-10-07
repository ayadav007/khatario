import type { PoolClient } from 'pg';
import { getPool, query, queryOne, queryRows } from '@/lib/db';
import { storeReceiptPaymentMode } from '@/lib/store/store-receipt';
import { loadSavedAgentSettings } from '@/lib/ai-agent/settings';

export class WhatsAppOrderInvoiceError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'WhatsAppOrderInvoiceError';
  }
}

export async function formatOrderLines(orderId: string): Promise<string> {
  const rows = await queryRows<{ item_name: string; qty: number | string; line_total: string | number | null }>(
    `SELECT item_name, qty, line_total
       FROM sales_order_items
      WHERE sales_order_id = $1
      ORDER BY sort_order ASC, id ASC`,
    [orderId],
  );
  return rows
    .map((r, i) => `${i + 1}. ${r.item_name} × ${Number(r.qty)} = ₹${parseFloat(String(r.line_total ?? 0))}`)
    .join('\n');
}

export async function orderConfirmedMessage(
  businessId: string,
  itemsList: string,
  grandTotal: number,
  invoiceNumber?: string | null,
  trackingUrl?: string | null,
): Promise<string> {
  const saved = await loadSavedAgentSettings(businessId).catch(() => null);
  const closing = saved?.postPaymentMessage.trim() || "Thank you for your order! We'll process it shortly.";
  const bill = invoiceNumber ? `\n🧾 Bill no: *${invoiceNumber}* (PDF below)` : '';
  const track = trackingUrl ? `\n📍 Track your order: ${trackingUrl}` : '';
  return `✅ Payment received! Your order has been confirmed.\n\n📦 *Order Details:*\n${itemsList}\n\n💰 *Total: ₹${grandTotal}*${bill}${track}\n\n${closing}`;
}

async function orderFulfilment(businessId: string, orderId: string): Promise<{ id: string; public_token: string } | null> {
  return queryOne<{ id: string; public_token: string }>(
    `SELECT id, public_token FROM order_fulfilments
      WHERE business_id = $1 AND sales_order_id = $2
      ORDER BY seq LIMIT 1`,
    [businessId, orderId],
  ).catch(() => null);
}

/** The payment confirmation doubles as the "order confirmed" update; never send that one again. */
async function markConfirmedNotified(businessId: string, fulfilmentId: string): Promise<void> {
  await query(
    `UPDATE order_fulfilments SET notified_statuses = array_append(notified_statuses, 'confirmed')
      WHERE id = $1 AND business_id = $2 AND NOT ('confirmed' = ANY(notified_statuses))`,
    [fulfilmentId, businessId],
  ).catch(() => undefined);
}

/** Gateway money lands in the bank, so an unrecognised method is booked to bank rather than cash. */
async function gatewayPaymentMode(client: PoolClient, businessId: string, orderId: string): Promise<string> {
  const tx = await client.query<{ payload: unknown }>(
    `SELECT raw_payload->'last_webhook' AS payload
       FROM payment_transactions
      WHERE business_id = $1 AND order_id = $2 AND status = 'success'
      ORDER BY created_at DESC
      LIMIT 1`,
    [businessId, orderId],
  );
  const mode = storeReceiptPaymentMode(tx.rows[0]?.payload ?? null);
  return mode === 'cash' ? 'bank' : mode;
}

async function invoiceAuthor(client: PoolClient, businessId: string): Promise<string> {
  const admin = await client.query<{ id: string }>(
    `SELECT id FROM users
      WHERE business_id = $1 AND COALESCE(is_active, true) = true
      ORDER BY COALESCE(is_primary_admin, false) DESC, created_at ASC
      LIMIT 1`,
    [businessId],
  );
  if (!admin.rows[0]) {
    throw new WhatsAppOrderInvoiceError('No business user available to author the invoice', 'ACTOR_REQUIRED');
  }
  return admin.rows[0].id;
}

/** The chat's customer record, matched on the last 10 phone digits, or created from the chat. */
async function whatsappCustomerId(
  client: PoolClient,
  businessId: string,
  branchId: string,
  phone: string,
  name: string | null,
): Promise<string | null> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const found = await client.query<{ id: string }>(
    `SELECT id FROM customers
      WHERE business_id = $1 AND deleted_at IS NULL
        AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = right($2, 10)
      ORDER BY created_at ASC
      LIMIT 1`,
    [businessId, digits],
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query<{ id: string }>(
    `INSERT INTO customers (business_id, branch_id, name, phone, notes)
     VALUES ($1, $2, $3, $4, 'Created from a paid WhatsApp order')
     RETURNING id`,
    [businessId, branchId, name?.trim() || `WhatsApp customer ${digits.slice(-4)}`, digits.slice(-10)],
  );
  return created.rows[0].id;
}

/**
 * Turns a fully paid WhatsApp bot order into a final tax invoice with the gateway receipt
 * posted against it. The order row is locked and `converted_invoice_id` links it, so a second
 * call returns the same invoice. Prices are treated as GST-inclusive because the customer paid
 * exactly the order total; the invoice must equal that amount.
 */
export async function invoicePaidWhatsAppOrder(
  businessId: string,
  orderId: string,
): Promise<{ invoiceId: string; invoiceNumber: string; created: boolean } | null> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT so.*, c.state_code AS customer_state_code,
              wc.conversation_id AS wa_phone, wc.whatsapp_display_name AS wa_name,
              (SELECT f.field_value FROM whatsapp_conversation_custom_fields f
                WHERE f.conversation_id = so.whatsapp_conversation_id AND f.business_id = so.business_id
                  AND f.field_key = 'customer_name') AS chat_name
         FROM sales_orders so
         LEFT JOIN customers c ON c.id = so.customer_id
         LEFT JOIN whatsapp_conversations wc ON wc.id = so.whatsapp_conversation_id AND wc.business_id = so.business_id
        WHERE so.id = $1 AND so.business_id = $2
        FOR UPDATE OF so`,
      [orderId, businessId],
    );
    const o = res.rows[0] as Record<string, any> | undefined;
    if (!o) {
      await client.query('ROLLBACK');
      return null;
    }
    if (o.converted_invoice_id) {
      const inv = await client.query<{ invoice_number: string }>(
        `SELECT invoice_number FROM invoices WHERE id = $1 AND business_id = $2`,
        [o.converted_invoice_id, businessId],
      );
      await client.query('COMMIT');
      return { invoiceId: o.converted_invoice_id, invoiceNumber: inv.rows[0]?.invoice_number ?? '', created: false };
    }
    if (o.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      return null;
    }
    if (['cancelled', 'rejected'].includes(String(o.status || '').toLowerCase())) {
      throw new WhatsAppOrderInvoiceError('A cancelled order cannot be invoiced', 'ORDER_CANCELLED');
    }

    const items = await client.query(
      `SELECT soi.*, i.tax_rate AS master_tax_rate, i.hsn_sac AS master_hsn, i.unit AS master_unit
         FROM sales_order_items soi
         LEFT JOIN items i ON i.id = soi.item_id AND i.business_id = $2
        WHERE soi.sales_order_id = $1
        ORDER BY soi.sort_order ASC, soi.id ASC`,
      [orderId, businessId],
    );
    if (items.rows.length === 0) {
      throw new WhatsAppOrderInvoiceError('Order has no items', 'ORDER_EMPTY');
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    const branchId = await resolveBranchId({ businessId, branchId: o.branch_id ?? null });
    const { todayIsoDate } = await import('@/lib/invoices/convert-to-invoice');
    const { createInvoiceInTransaction } = await import('@/lib/invoices/invoice-create-service');
    const invoiceDate = todayIsoDate();
    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    await assertPeriodNotLocked(businessId, branchId, invoiceDate, 'create the invoice for a paid WhatsApp order');

    let customerId: string | null = o.customer_id || null;
    if (!customerId && o.wa_phone) {
      customerId = await whatsappCustomerId(client, businessId, branchId, String(o.wa_phone), o.chat_name || o.wa_name || null);
      if (customerId) {
        await client.query(`UPDATE sales_orders SET customer_id = $1 WHERE id = $2 AND business_id = $3`, [
          customerId,
          orderId,
          businessId,
        ]);
      }
    }

    let locationId: string | null = null;
    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    if (await isWarehouseModeEnabled(businessId)) {
      const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
      locationId = await getDefaultWarehouseForBranch(branchId);
      if (!locationId) {
        throw new WhatsAppOrderInvoiceError(
          'Warehouse mode is on but the branch has no default warehouse',
          'WAREHOUSE_REQUIRED',
        );
      }
    }

    const total = Number(o.grand_total) || 0;
    const mode = await gatewayPaymentMode(client, businessId, orderId);
    const result = await createInvoiceInTransaction(client, {
      business_id: businessId,
      created_by: await invoiceAuthor(client, businessId),
      branch_id: branchId,
      customer_id: customerId,
      invoice_date: invoiceDate,
      due_date: invoiceDate,
      status: 'final',
      document_type: 'tax_invoice',
      prices_include_gst: true,
      enable_round_off: false,
      place_of_supply_state_code: o.place_of_supply_state_code || o.customer_state_code || null,
      billing_address: o.billing_address ?? null,
      shipping_address: o.shipping_address ?? null,
      notes: `WhatsApp order ${o.order_number} (paid online)`,
      channel: 'whatsapp',
      sales_order_id: orderId,
      items: items.rows.map((r: any) => ({
        item_id: r.item_id || null,
        item_name: r.item_name,
        description: r.description || null,
        hsn_sac: r.hsn_sac || r.master_hsn || null,
        quantity: Number(r.qty) || 0,
        unit: r.unit || r.master_unit || undefined,
        unit_price: Number(r.unit_price) || 0,
        discount_percent: Number(r.discount_percent) || 0,
        tax_rate: Number(r.tax_rate) || Number(r.master_tax_rate) || 0,
        location_id: locationId,
      })),
      payments: [{ amount: total, mode, date: invoiceDate, reference: o.payment_reference || undefined }],
    });

    if (Math.abs(result.grandTotal - total) > 0.02) {
      throw new WhatsAppOrderInvoiceError(
        `Invoice total ₹${result.grandTotal.toFixed(2)} does not match the paid amount ₹${total.toFixed(2)}`,
        'TOTAL_MISMATCH',
      );
    }

    await client.query(
      `UPDATE sales_order_items
          SET fulfilled_qty = qty
        WHERE sales_order_id = $1`,
      [orderId],
    );

    await client.query(
      `UPDATE stock_reservations
          SET status = 'fulfilled', fulfilled_at = CURRENT_TIMESTAMP
        WHERE business_id = $1 AND reserved_for_type = 'sales_order' AND reserved_for_id = $2
          AND status = 'active'`,
      [businessId, orderId],
    );

    const linked = await client.query(
      `UPDATE sales_orders
          SET status = 'fulfilled', converted_invoice_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3 AND converted_invoice_id IS NULL`,
      [result.invoiceId, orderId, businessId],
    );
    if (linked.rowCount !== 1) {
      throw new WhatsAppOrderInvoiceError('Order was already invoiced', 'ALREADY_INVOICED');
    }
    const { ensureFulfilment } = await import('@/lib/fulfilment/service');
    await ensureFulfilment(client, {
      businessId,
      channel: 'whatsapp',
      salesOrderId: orderId,
      invoiceId: result.invoiceId,
      branchId,
      customerId,
      buyerName: o.chat_name || o.wa_name || null,
      buyerPhone: o.wa_phone ? String(o.wa_phone).replace(/\D/g, '').slice(-12) : null,
      status: 'confirmed',
      actorType: 'system',
      note: 'Payment received',
    });
    await client.query('COMMIT');
    return { invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber, created: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Sets a one-time flag in `ocr_data`; true only for the caller that set it. */
export async function claimOrderFlag(businessId: string, orderId: string, flag: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE sales_orders
        SET ocr_data = COALESCE(ocr_data, '{}'::jsonb)
                       || jsonb_build_object($3::text, true, $3::text || '_at', to_jsonb((NOW() AT TIME ZONE 'UTC')::text)),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2
        AND COALESCE(ocr_data->>$3::text, '') NOT IN ('true', '1')
      RETURNING id`,
    [orderId, businessId, flag],
  );
  return !!row;
}

async function releaseOrderFlag(businessId: string, orderId: string, flag: string): Promise<void> {
  await query(
    `UPDATE sales_orders SET ocr_data = ocr_data - $3::text - ($3::text || '_at')
      WHERE id = $1 AND business_id = $2`,
    [orderId, businessId, flag],
  ).catch(() => undefined);
}

async function recordInInbox(
  businessId: string,
  conversationUuid: string,
  phone: string,
  text: string,
  messageId: string | null,
  messageType: 'text' | 'document',
): Promise<void> {
  const { storeOutgoingMessage } = await import('@/lib/whatsapp-crm');
  await storeOutgoingMessage(
    businessId,
    conversationUuid,
    `${phone}@s.whatsapp.net`,
    text,
    messageId ?? `paid_order_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    messageType,
    messageType === 'document' ? 'blob:pdf' : undefined,
    undefined,
    Math.floor(Date.now() / 1000),
    null,
    { sentBy: 'bot' },
  ).catch((err) => console.error('[paid-order] inbox record failed:', err instanceof Error ? err.message : err));
}

/**
 * Everything that follows a confirmed online payment for a WhatsApp bot order: the invoice,
 * the confirmation message and the PDF bill on the same chat. Each step happens once per order
 * however many times the gateway (webhook and browser return) or the chat calls this.
 * `confirmationSent` is set when the chat reply itself already carries the confirmation.
 * Never throws.
 */
export async function completePaidWhatsAppOrder(
  businessId: string,
  orderId: string,
  opts: { confirmationSent?: boolean } = {},
): Promise<void> {
  try {
    const order = await queryOne<{
      grand_total: string;
      payment_status: string | null;
      phone: string;
      conversation_uuid: string;
    }>(
      `SELECT so.grand_total::text, so.payment_status, wc.conversation_id AS phone, wc.id AS conversation_uuid
         FROM sales_orders so
         JOIN whatsapp_conversations wc ON wc.id = so.whatsapp_conversation_id AND wc.business_id = so.business_id
        WHERE so.id = $1 AND so.business_id = $2`,
      [orderId, businessId],
    );
    if (!order || order.payment_status !== 'paid') return;
    const phone = String(order.phone || '').replace(/\D/g, '');
    if (!phone) return;

    let invoice: Awaited<ReturnType<typeof invoicePaidWhatsAppOrder>> = null;
    try {
      invoice = await invoicePaidWhatsAppOrder(businessId, orderId);
    } catch (err) {
      console.error('[paid-order] invoice not created:', orderId, err instanceof Error ? err.message : err);
    }

    const { sendBusinessText, sendBusinessPdf } = await import('./business-transport');
    const fulfilment = await orderFulfilment(businessId, orderId);
    if (opts.confirmationSent && fulfilment) await markConfirmedNotified(businessId, fulfilment.id);

    if (!opts.confirmationSent && (await claimOrderFlag(businessId, orderId, 'whatsapp_order_confirmed'))) {
      const { orderTrackingUrl } = await import('@/lib/customer-surface/urls');
      const text = await orderConfirmedMessage(
        businessId,
        await formatOrderLines(orderId),
        parseFloat(order.grand_total) || 0,
        invoice?.invoiceNumber,
        fulfilment ? orderTrackingUrl(fulfilment.public_token) : null,
      );
      try {
        const sent = await sendBusinessText(businessId, phone, text);
        await recordInInbox(businessId, order.conversation_uuid, phone, text, sent.messageId, 'text');
        if (fulfilment) await markConfirmedNotified(businessId, fulfilment.id);
      } catch (err) {
        await releaseOrderFlag(businessId, orderId, 'whatsapp_order_confirmed');
        console.error('[paid-order] confirmation not sent:', orderId, err instanceof Error ? err.message : err);
      }
    }

    if (invoice && (await claimOrderFlag(businessId, orderId, 'whatsapp_bill_sent'))) {
      try {
        const { generateInvoicePdf } = await import('@/lib/pdf-generator');
        const buffer = await generateInvoicePdf(invoice.invoiceId);
        const filename = `${(invoice.invoiceNumber || 'bill').replace(/[^\w.-]+/g, '_')}.pdf`;
        const caption = `🧾 Bill ${invoice.invoiceNumber}`;
        const sent = await sendBusinessPdf(businessId, phone, { buffer, filename, caption });
        await recordInInbox(businessId, order.conversation_uuid, phone, caption, sent.messageId, 'document');
      } catch (err) {
        await releaseOrderFlag(businessId, orderId, 'whatsapp_bill_sent');
        console.error('[paid-order] bill not sent:', orderId, err instanceof Error ? err.message : err);
      }
    }

    await query(
      `DELETE FROM whatsapp_conversation_states WHERE business_id = $1 AND conversation_id = $2`,
      [businessId, order.phone],
    ).catch(() => undefined);
  } catch (err) {
    console.error('[paid-order] failed:', orderId, err instanceof Error ? err.message : err);
  }
}
