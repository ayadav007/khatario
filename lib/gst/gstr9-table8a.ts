import type { PoolClient } from 'pg';
import type { TaxBreakdown } from './gstr3b';

/**
 * GSTR-9 Table 8A: ITC on inward supplies pertaining to the FY as reflected in Table 3(I) of the
 * portal GSTR-2B (B2B / B2BA invoices and debit notes, less credit notes). Imports, ISD and
 * reverse-charge supplies are excluded, and so is ITC the portal marks as not available.
 * Documents dated in the FY count even when reported in the next FY's GSTR-2B up to October.
 */

export interface Gstr2bTable8ARow {
  filing_period: string;
  supplier_gstin: string;
  invoice_number: string;
  invoice_date: string;
  document_type: string;
  taxable_value: number | string | null;
  igst_amount: number | string | null;
  cgst_amount: number | string | null;
  sgst_amount: number | string | null;
  cess_amount: number | string | null;
  itc_eligibility: string | null;
  reverse_charge: string | null;
  original_invoice_number: string | null;
  original_invoice_date: string | null;
}

export interface Table8AResult {
  A: TaxBreakdown;
  portal_periods: string[];
  books_periods: string[];
  warnings: string[];
}

const TABLE_3I_DOC_TYPES = new Set(['invoice', 'debit_note', 'credit_note']);

const num = (v: unknown) => Number(v) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;
const empty = (): TaxBreakdown => ({ taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

export function fyBounds(financialYear: number) {
  return { from: `${financialYear}-04-01`, to: `${financialYear + 1}-03-31` };
}

/** FY months (Apr..Mar) and the GSTR-2B periods that can carry FY documents (Apr..Oct of next FY). */
export function table8APeriods(financialYear: number) {
  const period = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
  const fyMonths: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    fyMonths.push(period(m >= 4 ? financialYear : financialYear + 1, m));
  }
  const portalPeriods = [...fyMonths];
  for (let m = 4; m <= 10; m++) portalPeriods.push(period(financialYear + 1, m));
  return { fyMonths, portalPeriods };
}

function docKey(gstin: string, type: string, number: string, date: string) {
  return `${gstin.toUpperCase()}|${type}|${number.trim().toUpperCase()}|${date}`;
}

/** Sums portal GSTR-2B rows into Table 8A. An amended document replaces the one it amends. */
export function aggregateTable8AFromPortal(rows: Gstr2bTable8ARow[], financialYear: number): TaxBreakdown {
  const { from, to } = fyBounds(financialYear);
  const docs = new Map<string, Gstr2bTable8ARow>();
  const ordered = rows
    .filter((r) => TABLE_3I_DOC_TYPES.has(r.document_type))
    .sort((a, b) => a.filing_period.localeCompare(b.filing_period));

  for (const r of ordered) {
    if (r.original_invoice_number && r.original_invoice_date) {
      docs.delete(docKey(r.supplier_gstin, r.document_type, r.original_invoice_number, ymd(r.original_invoice_date)));
    }
    docs.set(docKey(r.supplier_gstin, r.document_type, r.invoice_number, ymd(r.invoice_date)), r);
  }

  const out = empty();
  for (const r of docs.values()) {
    const date = ymd(r.invoice_date);
    if (date < from || date > to) continue;
    if (String(r.reverse_charge || 'N').toUpperCase() === 'Y') continue;
    if ((r.itc_eligibility || 'eligible') !== 'eligible') continue;
    const sign = r.document_type === 'credit_note' ? -1 : 1;
    out.taxable_value += sign * num(r.taxable_value);
    out.igst += sign * num(r.igst_amount);
    out.cgst += sign * num(r.cgst_amount);
    out.sgst += sign * num(r.sgst_amount);
    out.cess += sign * num(r.cess_amount);
  }
  return {
    taxable_value: round2(out.taxable_value),
    igst: round2(out.igst),
    cgst: round2(out.cgst),
    sgst: round2(out.sgst),
    cess: round2(out.cess),
  };
}

/**
 * Portal GSTR-2B where imported (latest import per period); months with no import fall back to
 * the purchase register for registered, non-RCM, non-import bills and are flagged in warnings.
 */
export async function computeTable8A(
  client: PoolClient,
  businessId: string,
  financialYear: number
): Promise<Table8AResult> {
  const { fyMonths, portalPeriods } = table8APeriods(financialYear);
  const { from, to } = fyBounds(financialYear);

  const imports = await client.query<{ id: string; filing_period: string }>(
    `SELECT DISTINCT ON (filing_period) id, filing_period
       FROM gstr2b_imports
      WHERE business_id = $1 AND filing_period = ANY($2::text[])
      ORDER BY filing_period, import_date DESC, created_at DESC`,
    [businessId, portalPeriods]
  );
  const importedPeriods = imports.rows.map((r) => r.filing_period).sort();

  let A = empty();
  if (imports.rows.length > 0) {
    const rows = await client.query<Gstr2bTable8ARow>(
      `SELECT filing_period, supplier_gstin, invoice_number, invoice_date::text AS invoice_date, document_type,
              taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, itc_eligibility, reverse_charge,
              original_invoice_number, original_invoice_date::text AS original_invoice_date
         FROM gstr2b_invoices
        WHERE business_id = $1 AND import_id = ANY($2::uuid[])`,
      [businessId, imports.rows.map((r) => r.id)]
    );
    A = aggregateTable8AFromPortal(rows.rows, financialYear);
  }

  const imported = new Set(importedPeriods);
  const booksPeriods = fyMonths.filter((m) => !imported.has(m));
  const warnings: string[] = [];

  if (booksPeriods.length > 0) {
    const regularInward = `
      p.business_id = $1 AND p.status = 'final' AND p.deleted_at IS NULL
      AND COALESCE(p.is_reverse_charge, false) = false
      AND COALESCE(p.document_type, '') NOT IN ('bill_of_entry', 'import_service')
      AND LENGTH(COALESCE(p.supplier_gstin, '')) >= 15
      AND COALESCE(p.itc_eligible, true)`;

    const bills = await client.query(
      `SELECT COALESCE(SUM(pi.taxable_value), 0) AS taxable, COALESCE(SUM(pi.igst_amount), 0) AS igst,
              COALESCE(SUM(pi.cgst_amount), 0) AS cgst, COALESCE(SUM(pi.sgst_amount), 0) AS sgst,
              COALESCE(SUM(pi.cess_amount), 0) AS cess
         FROM purchases p
         JOIN purchase_items pi ON pi.purchase_id = p.id
        WHERE ${regularInward}
          AND p.bill_date BETWEEN $2 AND $3
          AND to_char(p.bill_date, 'YYYY-MM') = ANY($4::text[])`,
      [businessId, from, to, booksPeriods]
    );
    const returns = await client.query(
      `SELECT COALESCE(SUM(pr.subtotal), 0) AS taxable, COALESCE(SUM(pr.igst_total), 0) AS igst,
              COALESCE(SUM(pr.cgst_total), 0) AS cgst, COALESCE(SUM(pr.sgst_total), 0) AS sgst
         FROM purchase_returns pr
         JOIN purchases p ON p.id = pr.purchase_id
        WHERE ${regularInward}
          AND pr.business_id = $1
          AND COALESCE(pr.status, 'final') <> 'cancelled'
          AND pr.return_date BETWEEN $2 AND $3
          AND to_char(pr.return_date, 'YYYY-MM') = ANY($4::text[])`,
      [businessId, from, to, booksPeriods]
    );
    const b = bills.rows[0] || {};
    const r = returns.rows[0] || {};
    A = {
      taxable_value: round2(A.taxable_value + num(b.taxable) - num(r.taxable)),
      igst: round2(A.igst + num(b.igst) - num(r.igst)),
      cgst: round2(A.cgst + num(b.cgst) - num(r.cgst)),
      sgst: round2(A.sgst + num(b.sgst) - num(r.sgst)),
      cess: round2(A.cess + num(b.cess)),
    };
    warnings.push(
      `Table 8A: no GSTR-2B imported for ${booksPeriods.join(', ')}. Those months are estimated from the purchase register ` +
        `(registered suppliers, excluding reverse charge and imports). Import the portal GSTR-2B for the exact Table 8A.`
    );
  }

  return { A, portal_periods: importedPeriods, books_periods: booksPeriods, warnings };
}
