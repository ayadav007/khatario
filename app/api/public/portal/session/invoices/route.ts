import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import {
  ensureInvoicePublicToken,
  getCustomerPortalSessionFromRequest,
  publicInvoiceUrl,
} from '@/lib/customer-surface';

/**
 * GET /api/public/portal/session/invoices
 * List final invoices for the logged-in portal customer.
 */
export async function GET(request: NextRequest) {
  const session = await getCustomerPortalSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const rows = await queryRows<{
    id: string;
    invoice_number: string;
    invoice_date: string | null;
    due_date: string | null;
    grand_total: string | number;
    paid_amount: string | number;
    balance_amount: string | number | null;
    document_type: string | null;
    status: string;
    public_token: string | null;
    first_viewed_at: string | null;
  }>(
    `SELECT
       id,
       invoice_number,
       invoice_date,
       due_date,
       grand_total,
       paid_amount,
       balance_amount,
       document_type,
       status,
       public_token,
       first_viewed_at
     FROM invoices
     WHERE business_id = $1
       AND customer_id = $2
       AND deleted_at IS NULL
       AND status = 'final'
     ORDER BY invoice_date DESC NULLS LAST, created_at DESC
     LIMIT 200`,
    [session.business_id, session.customer_id]
  );

  const invoices = await Promise.all(
    rows.map(async (row) => {
      let token = row.public_token;
      if (!token) {
        token = await ensureInvoicePublicToken(row.id);
      }
      const grand = Number(row.grand_total ?? 0);
      const paid = Number(row.paid_amount ?? 0);
      const balance =
        row.balance_amount != null ? Number(row.balance_amount) : grand - paid;
      let payment_status: 'paid' | 'partial' | 'unpaid' = 'unpaid';
      if (balance <= 0.01 && paid > 0) payment_status = 'paid';
      else if (paid > 0.01 && balance > 0.01) payment_status = 'partial';

      return {
        id: row.id,
        invoice_number: row.invoice_number,
        invoice_date: row.invoice_date,
        due_date: row.due_date,
        grand_total: grand,
        balance_amount: balance,
        payment_status,
        document_type: row.document_type,
        public_url: publicInvoiceUrl(token),
        public_token: token,
        viewed: Boolean(row.first_viewed_at),
      };
    })
  );

  const outstanding = invoices.reduce((sum, inv) => sum + Math.max(0, inv.balance_amount), 0);

  return NextResponse.json({
    customer: {
      id: session.customer_id,
      name: session.customer_name,
    },
    invoices,
    outstanding_total: outstanding,
  });
}
