import { NextRequest, NextResponse } from 'next/server';
import { queryOne, getPool } from '@/lib/db';

/**
 * POST /api/whatsapp/orders/[id]/approve
 * Approve WhatsApp order, convert to invoice, and notify customer
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const orderId = params.id;
  const pool = getPool();
  const client = await pool.connect();

  try {
    const { business_id } = await request.json();

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    await client.query('BEGIN');

    // 1. Get order details
    const orderRes = await client.query(
      `SELECT * FROM sales_orders WHERE id = $1 AND business_id = $2`,
      [orderId, business_id]
    );

    if (orderRes.rowCount === 0) {
      throw new Error('Order not found');
    }

    const order = orderRes.rows[0];

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let invoiceBranchId: string;
    try {
      invoiceBranchId = await resolveBranchId({
        branchId: null,
        businessId: business_id,
      });
    } catch (e: any) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: e.message || 'Could not resolve branch for invoice' },
        { status: 400 }
      );
    }

    // 2. Get order items
    const itemsRes = await client.query(
      `SELECT * FROM sales_order_items WHERE sales_order_id = $1`,
      [orderId]
    );
    const items = itemsRes.rows;

    // 3. Convert to Invoice (using internal helper logic)
    // For simplicity, we'll reuse the createCashSaleInvoice logic or similar
    
    // Get business settings for invoice number
    const businessRes = await client.query(
      `SELECT next_invoice_number, invoice_prefix FROM businesses WHERE id = $1`,
      [business_id]
    );
    const business = businessRes.rows[0];
    const invoiceNumber = `${business.invoice_prefix || 'INV'}-${String(business.next_invoice_number).padStart(4, '0')}`;

    const today = new Date().toISOString().split('T')[0];

    // Create invoice
    const invoiceRes = await client.query(
      `INSERT INTO invoices (
        business_id, branch_id, customer_id, invoice_number, invoice_date, due_date,
        status, payment_status, subtotal, grand_total, paid_amount, balance_amount,
        document_type, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, invoice_number`,
      [
        business_id,
        invoiceBranchId,
        order.customer_id,
        invoiceNumber,
        today,
        today,
        'final',
        'paid', // Marked as paid since it was approved
        order.subtotal,
        order.grand_total,
        order.grand_total, // full paid
        0, // balance
        'tax_invoice'
      ]
    );

    const invoice = invoiceRes.rows[0];

    // Create invoice items
    for (const item of items) {
      await client.query(
        `INSERT INTO invoice_items (
          invoice_id, item_id, item_name, quantity, unit_price, line_total, tax_rate
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          invoice.id,
          item.item_id,
          item.item_name,
          item.qty,
          item.unit_price,
          item.line_total,
          0 // Default tax for now
        ]
      );
    }

    // 4. Record Payment
    await client.query(
      `INSERT INTO payments (
        business_id, branch_id, customer_id, type, amount, payment_mode,
        payment_date, reference_type, reference_id, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        business_id,
        invoiceBranchId,
        order.customer_id,
        'receivable',
        order.grand_total,
        'upi',
        today,
        'invoice',
        invoice.id,
        `WhatsApp Order ${order.order_number} Approved`
      ]
    );

    // 5. Update Order status
    await client.query(
      `UPDATE sales_orders SET status = 'fulfilled', converted_invoice_id = $1 WHERE id = $2`,
      [invoice.id, orderId]
    );

    // 6. Increment counters
    await client.query(
      `UPDATE businesses SET next_invoice_number = next_invoice_number + 1 WHERE id = $1`,
      [business_id]
    );

    await client.query('COMMIT');

    // 7. Notify customer via WhatsApp (optional but recommended)
    // This would call sendWhatsAppMessage in background

    return NextResponse.json({ 
      success: true, 
      invoice_id: invoice.id, 
      invoice_number: invoice.invoice_number 
    });

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error approving WhatsApp order:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    client.release();
  }
}
