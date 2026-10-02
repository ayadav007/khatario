import * as db from '@/lib/db';
import type { AgeingDoc } from '@/lib/reports/ageing';

export type PartyType = 'customer' | 'supplier';

const CUSTOMER_SQL = `
  WITH v AS (
    SELECT lel.voucher_type, lel.voucher_id, SUM(lel.debit - lel.credit) AS net, MIN(lel.entry_date) AS first_date
      FROM ledger_entry_lines lel
      JOIN accounts a ON a.id = lel.account_id
     WHERE lel.business_id = $1 AND a.account_code LIKE '1103%'
       AND lel.entry_date <= $2::date
       AND ($3::uuid IS NULL OR lel.branch_id = $3::uuid)
     GROUP BY lel.voucher_type, lel.voucher_id
    HAVING ABS(SUM(lel.debit - lel.credit)) >= 0.005
  ), d AS (
    SELECT v.voucher_type, v.voucher_id, v.net,
      COALESCE(i.customer_id, dn.customer_id, cn.customer_id, p.customer_id, pi.customer_id, ap.customer_id,
               CASE WHEN v.voucher_type = 'opening_balance' THEN v.voucher_id END) AS party_id,
      COALESCE(i.invoice_number, dn.debit_note_number, cn.credit_note_number,
               CASE WHEN p.id IS NOT NULL THEN 'PAY-' || substring(p.id::text, 1, 8) END,
               CASE WHEN pi.id IS NOT NULL THEN 'Receipt ' || pi.invoice_number END,
               aa.voucher_number,
               CASE WHEN v.voucher_type = 'opening_balance' THEN 'Opening Balance' END) AS reference,
      COALESCE(i.invoice_date, dn.debit_note_date, cn.credit_note_date, p.payment_date, aa.adjustment_date, v.first_date)::text AS doc_date,
      i.due_date::text AS due_date,
      COALESCE(cn.invoice_id, CASE WHEN p.reference_type = 'invoice' THEN p.reference_id END, pi.id, aa.invoice_id) AS linked_id,
      CASE
        WHEN v.voucher_type = 'payment' AND COALESCE(p.tds_amount, 0) > 0
          THEN 'Receipt - ' || COALESCE(p.payment_mode, '') || ' (incl. TDS ' || p.tds_amount || ')'
        WHEN v.voucher_type = 'payment' THEN 'Receipt - ' || COALESCE(p.payment_mode, '')
        WHEN v.voucher_type = 'invoice' THEN 'Sale'
        WHEN v.voucher_type = 'credit_note' THEN 'Credit note' || COALESCE(' - ' || cn.reason, '')
        WHEN v.voucher_type = 'debit_note' THEN 'Debit note' || COALESCE(' - ' || dn.reason, '')
        WHEN v.voucher_type = 'advance_adjustment' THEN 'Advance ' || COALESCE(ap.voucher_number, '') || ' adjusted'
        WHEN v.voucher_type = 'opening_balance' THEN 'Opening balance'
        ELSE initcap(replace(v.voucher_type, '_', ' '))
      END AS description
    FROM v
    LEFT JOIN invoices i ON v.voucher_type = 'invoice' AND i.id = v.voucher_id
    LEFT JOIN debit_notes dn ON v.voucher_type = 'debit_note' AND dn.id = v.voucher_id
    LEFT JOIN credit_notes cn ON v.voucher_type = 'credit_note' AND cn.id = v.voucher_id
    LEFT JOIN payments p ON v.voucher_type = 'payment' AND p.id = v.voucher_id
    LEFT JOIN invoices pi ON v.voucher_type = 'payment' AND p.id IS NULL AND pi.id = v.voucher_id
    LEFT JOIN advance_adjustments aa ON v.voucher_type = 'advance_adjustment' AND aa.voucher_id = v.voucher_id AND aa.business_id = $1
    LEFT JOIN advance_payments ap ON ap.id = aa.advance_id
  )
  SELECT d.*, c.name AS party_name, c.phone AS party_phone
    FROM d LEFT JOIN customers c ON c.id = d.party_id AND c.business_id = $1
   WHERE ($4::uuid IS NULL OR d.party_id = $4::uuid)`;

const SUPPLIER_SQL = `
  WITH v AS (
    SELECT lel.voucher_type, lel.voucher_id, SUM(lel.credit - lel.debit) AS net, MIN(lel.entry_date) AS first_date
      FROM ledger_entry_lines lel
      JOIN accounts a ON a.id = lel.account_id
     WHERE lel.business_id = $1 AND a.account_code LIKE '2101%'
       AND lel.entry_date <= $2::date
       AND ($3::uuid IS NULL OR lel.branch_id = $3::uuid)
     GROUP BY lel.voucher_type, lel.voucher_id
    HAVING ABS(SUM(lel.credit - lel.debit)) >= 0.005
  ), d AS (
    SELECT v.voucher_type, v.voucher_id, v.net,
      COALESCE(pu.supplier_id, pr.supplier_id, p.supplier_id, t.supplier_id, ap.supplier_id,
               CASE WHEN v.voucher_type = 'opening_balance' THEN v.voucher_id END) AS party_id,
      COALESCE(pu.bill_number, pr.return_number,
               CASE WHEN p.id IS NOT NULL THEN 'PAY-' || substring(p.id::text, 1, 8) END,
               CASE WHEN t.id IS NOT NULL THEN 'TDS ' || t.section_code END,
               aa.voucher_number,
               CASE WHEN v.voucher_type = 'opening_balance' THEN 'Opening Balance' END) AS reference,
      COALESCE(pu.bill_date, pr.return_date, p.payment_date, t.transaction_date, aa.adjustment_date, v.first_date)::text AS doc_date,
      pu.due_date::text AS due_date,
      COALESCE(pr.purchase_id, CASE WHEN p.reference_type = 'purchase' THEN p.reference_id END, t.purchase_id, aa.purchase_id) AS linked_id,
      CASE
        WHEN v.voucher_type = 'purchase' THEN 'Purchase'
        WHEN v.voucher_type = 'payment' THEN 'Payment - ' || COALESCE(p.payment_mode, '')
        WHEN v.voucher_type = 'purchase_return' THEN 'Purchase return (debit note)'
        WHEN v.voucher_type = 'tds' THEN 'TDS deducted u/s ' || COALESCE(t.section_code, '')
             || CASE WHEN t.status = 'cancelled' THEN ' (cancelled)' ELSE '' END
        WHEN v.voucher_type = 'advance_adjustment' THEN 'Advance ' || COALESCE(ap.voucher_number, '') || ' adjusted'
        WHEN v.voucher_type = 'opening_balance' THEN 'Opening balance'
        ELSE initcap(replace(v.voucher_type, '_', ' '))
      END AS description
    FROM v
    LEFT JOIN purchases pu ON v.voucher_type = 'purchase' AND pu.id = v.voucher_id
    LEFT JOIN purchase_returns pr ON v.voucher_type = 'purchase_return' AND pr.id = v.voucher_id
    LEFT JOIN payments p ON v.voucher_type = 'payment' AND p.id = v.voucher_id
    LEFT JOIN tds_transactions t ON v.voucher_type = 'tds' AND t.id = v.voucher_id
    LEFT JOIN advance_adjustments aa ON v.voucher_type = 'advance_adjustment' AND aa.voucher_id = v.voucher_id AND aa.business_id = $1
    LEFT JOIN advance_payments ap ON ap.id = aa.advance_id
  )
  SELECT d.*, s.name AS party_name, s.phone AS party_phone
    FROM d LEFT JOIN suppliers s ON s.id = d.party_id AND s.business_id = $1
   WHERE ($4::uuid IS NULL OR d.party_id = $4::uuid)`;

type DocRow = {
  voucher_type: string;
  voucher_id: string;
  net: string;
  party_id: string | null;
  party_name: string | null;
  party_phone: string | null;
  reference: string | null;
  doc_date: string;
  due_date: string | null;
  linked_id: string | null;
  description: string | null;
};

export type PartyLedgerDoc = AgeingDoc & { description: string };

/**
 * Control-account (Receivables 1103 / Payables 2101) movements per voucher up to `asOfDate`,
 * attributed to the party via the source document. `amount` is positive when it increases what
 * the party owes (customer) or what we owe (supplier).
 */
export async function fetchPartyLedgerDocs(params: {
  businessId: string;
  partyType: PartyType;
  asOfDate: string;
  branchId?: string | null;
  partyId?: string | null;
}): Promise<PartyLedgerDoc[]> {
  const rows = await db.queryRows<DocRow>(params.partyType === 'customer' ? CUSTOMER_SQL : SUPPLIER_SQL, [
    params.businessId,
    params.asOfDate,
    params.branchId ?? null,
    params.partyId ?? null,
  ]);
  return rows.map((r) => ({
    voucherType: r.voucher_type,
    voucherId: r.voucher_id,
    partyId: r.party_id,
    partyName: r.party_name,
    partyPhone: r.party_phone,
    reference: r.reference || r.voucher_type,
    docDate: String(r.doc_date).slice(0, 10),
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
    amount: Number(r.net) || 0,
    linkedVoucherId: r.linked_id,
    description: r.description || r.voucher_type,
  }));
}
