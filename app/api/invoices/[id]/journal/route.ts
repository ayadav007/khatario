import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { activeLedgerLineSql } from '@/lib/ledger-reversal';

export const dynamic = 'force-dynamic';

type JournalLineRow = {
  voucher_type: string;
  voucher_id: string;
  reference: string | null;
  sort_date: string | null;
  sort_order: number;
  line_id: string | null;
  entry_date: string | null;
  account_code: string | null;
  account_name: string | null;
  debit: string | null;
  credit: string | null;
  narration: string | null;
  is_reversed: boolean;
};

const LABELS: Record<string, string> = {
  invoice: 'Sale',
  payment: 'Receipt',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
  advance_adjustment: 'Advance',
  credit_note_refund: 'Refund',
};

/**
 * GET /api/invoices/[id]/journal
 * Every ledger voucher tied to this invoice: the sale, receipts, credit and debit notes,
 * advance adjustments, and refunds of those credit notes. Each voucher returns the lines
 * still on the books. A fully reversed voucher is included with reversed: true.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const invoiceId = params.id;
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    const businessScope = getSessionScopedBusinessId(request);
    if (!businessScope) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const invoice = await queryOne<{ id: string; business_id: string; branch_id: string | null; status: string }>(
      'SELECT id, business_id, branch_id, status FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [invoiceId, businessScope]
    );
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'invoices', 'read', {
        businessId: invoice.business_id,
        branchId: invoice.branch_id ?? undefined,
        resourceId: invoiceId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const rows = await queryRows<JournalLineRow>(
      `WITH related AS (
         SELECT 'invoice'::text AS voucher_type, i.id AS voucher_id,
                i.invoice_number::text AS reference, i.invoice_date::date AS sort_date, 0 AS sort_order
           FROM invoices i
          WHERE i.business_id = $1 AND i.id = $2
         UNION ALL
         SELECT 'payment', p.id, COALESCE(NULLIF(p.payment_mode, ''), 'receipt')::text, p.payment_date::date, 1
           FROM payments p
          WHERE p.business_id = $1 AND p.reference_type = 'invoice' AND p.reference_id = $2
         UNION ALL
         SELECT 'credit_note', cn.id, cn.credit_note_number::text, cn.credit_note_date::date, 2
           FROM credit_notes cn
          WHERE cn.business_id = $1 AND cn.invoice_id = $2
         UNION ALL
         SELECT 'debit_note', dn.id, dn.debit_note_number::text, dn.debit_note_date::date, 3
           FROM debit_notes dn
          WHERE dn.business_id = $1 AND dn.invoice_id = $2
         UNION ALL
         SELECT 'advance_adjustment', aa.voucher_id, COALESCE(aa.voucher_number, 'Advance')::text, aa.adjustment_date::date, 4
           FROM advance_adjustments aa
          WHERE aa.business_id = $1 AND aa.kind = 'invoice' AND aa.invoice_id = $2 AND aa.voucher_id IS NOT NULL
         UNION ALL
         SELECT 'credit_note_refund', r.id, r.voucher_number::text, r.refund_date::date, 5
           FROM credit_note_refunds r
           JOIN credit_notes cn ON cn.id = r.credit_note_id AND cn.business_id = r.business_id
          WHERE r.business_id = $1 AND cn.invoice_id = $2
       )
       SELECT r.voucher_type, r.voucher_id::text AS voucher_id, r.reference,
              r.sort_date::text AS sort_date, r.sort_order,
              lel.id::text AS line_id, lel.entry_date::text AS entry_date,
              a.account_code, a.account_name, lel.debit::text AS debit, lel.credit::text AS credit, lel.narration,
              (lel.id IS NOT NULL AND NOT (${activeLedgerLineSql('lel')})) AS is_reversed
         FROM related r
         LEFT JOIN ledger_entry_lines lel
           ON lel.business_id = $1
          AND lel.voucher_id = r.voucher_id
          AND lel.voucher_type = r.voucher_type
         LEFT JOIN accounts a ON a.id = lel.account_id
        ORDER BY r.sort_date NULLS LAST, r.sort_order, r.voucher_id,
                 lel.debit DESC NULLS LAST, lel.credit DESC NULLS LAST, a.account_name`,
      [invoice.business_id, invoiceId]
    );

    type Journal = {
      voucher_type: string;
      voucher_id: string;
      label: string;
      reference: string | null;
      entry_date: string | null;
      reversed: boolean;
      lines: Array<{
        id: string;
        account_code: string | null;
        account_name: string | null;
        debit: string;
        credit: string;
        narration: string | null;
      }>;
    };

    const journals: Journal[] = [];
    const byKey = new Map<string, Journal>();
    for (const row of rows) {
      const key = `${row.voucher_type}:${row.voucher_id}`;
      let journal = byKey.get(key);
      if (!journal) {
        journal = {
          voucher_type: row.voucher_type,
          voucher_id: row.voucher_id,
          label: LABELS[row.voucher_type] || row.voucher_type,
          reference: row.reference,
          entry_date: row.sort_date,
          reversed: false,
          lines: [],
        };
        byKey.set(key, journal);
        journals.push(journal);
      }
      if (!row.line_id) continue;
      if (row.entry_date && (!journal.entry_date || row.entry_date < journal.entry_date)) {
        journal.entry_date = row.entry_date;
      }
      if (row.is_reversed) {
        continue;
      }
      journal.lines.push({
        id: row.line_id,
        account_code: row.account_code,
        account_name: row.account_name,
        debit: row.debit || '0',
        credit: row.credit || '0',
        narration: row.narration,
      });
    }

    for (const journal of journals) {
      const hadLines = rows.some(
        (row) => row.voucher_type === journal.voucher_type && row.voucher_id === journal.voucher_id && row.line_id
      );
      journal.reversed = hadLines && journal.lines.length === 0;
    }

    const sale = journals.find((journal) => journal.voucher_type === 'invoice');
    const lines = sale?.lines || [];
    const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);

    return NextResponse.json({
      journals,
      lines,
      reversed: !!sale?.reversed,
      total_debit: totalDebit,
      total_credit: totalCredit,
    });
  } catch (error: unknown) {
    console.error('Error fetching invoice journal:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
