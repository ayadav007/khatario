import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { inBuyerUnits, loadBillForBuyer, loadBillLines, resolveBillLines } from '@/lib/supplier-bills';

export const dynamic = 'force-dynamic';

/**
 * GET /api/purchases/incoming-bills/[invoiceId]
 * One connected supplier's bill as the receive screen needs it: each line with the buyer's
 * matched item and quantity in the buyer's unit (or suggestions when unmatched), and the
 * receipt if it has already been received.
 */
export async function GET(request: NextRequest, { params }: { params: { invoiceId: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  const client = await db.getPool().connect();
  try {
    await authorize(auth.userId, 'purchases', 'read', { businessId: auth.businessId });
    const access = await loadBillForBuyer(client, params.invoiceId, auth.businessId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const { invoice, supplierId, linkedRequests } = access;

    const lines = await loadBillLines(client, params.invoiceId);
    const resolution = await resolveBillLines(client, {
      buyerBusinessId: auth.businessId,
      vendorBusinessId: invoice.business_id,
      lines,
      linkedRequests,
      choices: new Map(),
    });
    if (!resolution.ok) return NextResponse.json({ error: resolution.error }, { status: 400 });
    const unmatchedById = new Map(resolution.unmatched.map((u) => [u.invoice_item_id, u]));

    const purchaseRes = await client.query(
      `SELECT p.id, p.bill_number, p.status, rc.id AS receipt_id, rc.status AS receipt_status, rc.received_at
         FROM purchases p
         LEFT JOIN supplier_bill_receipts rc ON rc.purchase_id = p.id
        WHERE p.business_id = $1 AND p.source_invoice_id = $2 AND p.status <> 'cancelled'
        LIMIT 1`,
      [auth.businessId, params.invoiceId]
    );
    const purchase = purchaseRes.rows[0] ?? null;
    let receiptLines: any[] = [];
    let returns: any[] = [];
    if (purchase?.receipt_id) {
      receiptLines = (
        await client.query(
          `SELECT invoice_item_id, buyer_item_id, item_name, billed_qty, short_qty, damaged_qty, note
             FROM supplier_bill_receipt_lines WHERE receipt_id = $1`,
          [purchase.receipt_id]
        )
      ).rows;
    }
    if (purchase) {
      returns = (
        await client.query(
          `SELECT id, return_number, return_date, grand_total
             FROM purchase_returns
            WHERE purchase_id = $1 AND business_id = $2 AND COALESCE(status, 'final') <> 'cancelled'
            ORDER BY return_date`,
          [purchase.id, auth.businessId]
        )
      ).rows;
    }

    // Pay by UPI: the supplier's default UPI ID, with amount and bill number filled in.
    const { supplierUpiId, upiPayLink } = await import('@/lib/supplier-hub-money');
    const upiId = await supplierUpiId(invoice.business_id);
    const pay = upiId
      ? {
          upi_id: upiId,
          link: upiPayLink({
            upiId,
            payeeName: invoice.supplier_business_name || 'Supplier',
            amount: Number(invoice.grand_total) || 0,
            billNumber: invoice.invoice_number,
          }),
        }
      : null;

    return NextResponse.json({
      pay,
      bill: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        supplier_name: invoice.supplier_business_name,
        supplier_id: supplierId,
        subtotal: invoice.subtotal,
        tax_total: invoice.tax_total,
        grand_total: invoice.grand_total,
      },
      lines: lines.map((line, i) => {
        const r = resolution.resolved[i];
        const own = r.itemId ? inBuyerUnits(line, r.factor) : null;
        return {
          invoice_item_id: line.id,
          item_name: line.item_name,
          hsn_sac: line.hsn_sac,
          quantity: Number(line.quantity),
          unit: line.unit,
          unit_price: Number(line.unit_price),
          tax_rate: Number(line.tax_rate) || 0,
          line_total: Number(line.line_total),
          is_service: line.vendor_item_type === 'service',
          match: r.itemId
            ? {
                item_id: r.itemId,
                item_name: r.itemName,
                unit: r.unit,
                factor: r.factor,
                quantity: own!.qty,
                rate: own!.rate,
              }
            : null,
          suggestions: unmatchedById.get(String(line.id))?.suggestions ?? [],
        };
      }),
      purchase,
      receipt_lines: receiptLines,
      purchase_returns: returns,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('incoming-bill GET', error);
    return NextResponse.json({ error: 'Failed to load the bill' }, { status: 500 });
  } finally {
    client.release();
  }
}
