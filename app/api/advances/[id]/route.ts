import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';

export const dynamic = 'force-dynamic';

/** GET /api/advances/[id] — the advance, its adjustments / refunds, and the party's open documents. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const guard = await guardLedgerRoute(request, {
      claimedBusinessId: new URL(request.url).searchParams.get('business_id'),
      action: 'read',
    });
    if (!guard.ok) return guard.response;
    const { businessId } = guard;

    const advance = await queryOne(
      `SELECT a.*, a.payment_date::text AS payment_date, COALESCE(c.name, s.name) AS party_name,
              (a.amount - a.adjusted_amount - a.refunded_amount) AS remaining
         FROM advance_payments a
         LEFT JOIN customers c ON c.id = a.customer_id
         LEFT JOIN suppliers s ON s.id = a.supplier_id
        WHERE a.id = $1 AND a.business_id = $2`,
      [id, businessId]
    );
    if (!advance) return NextResponse.json({ error: 'Advance not found' }, { status: 404 });

    const adjustments = await queryRows(
      `SELECT aa.id, aa.kind, aa.adjustment_date::text, aa.amount, aa.taxable_value, aa.cgst, aa.sgst, aa.igst,
              aa.cess, aa.voucher_number, aa.reversed_at, aa.reversal_reason, i.invoice_number, p.bill_number
         FROM advance_adjustments aa
         LEFT JOIN invoices i ON i.id = aa.invoice_id
         LEFT JOIN purchases p ON p.id = aa.purchase_id
        WHERE aa.advance_id = $1 AND aa.business_id = $2
        ORDER BY aa.adjustment_date, aa.created_at`,
      [id, businessId]
    );

    const openDocuments =
      advance.type === 'received'
        ? await queryRows(
            `SELECT id, invoice_number AS number, invoice_date::text AS date, grand_total, balance_amount
               FROM invoices
              WHERE business_id = $1 AND customer_id = $2 AND deleted_at IS NULL AND status = 'final'
                AND COALESCE(document_type, 'tax_invoice') <> 'proforma_invoice' AND balance_amount > 0.005
              ORDER BY invoice_date, invoice_number`,
            [businessId, advance.customer_id]
          )
        : await queryRows(
            `SELECT id, bill_number AS number, bill_date::text AS date, grand_total, balance_amount
               FROM purchases
              WHERE business_id = $1 AND supplier_id = $2 AND deleted_at IS NULL
                AND COALESCE(status, '') <> 'cancelled' AND balance_amount > 0.005
              ORDER BY bill_date, bill_number`,
            [businessId, advance.supplier_id]
          );

    return NextResponse.json({ advance, adjustments, open_documents: openDocuments });
  } catch (error: any) {
    console.error('Error loading advance:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
