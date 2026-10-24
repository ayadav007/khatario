import type { Pool } from 'pg';
import { round2 } from '@/lib/invoices/line-gst';

export type InvoiceSettlementKind = 'payment' | 'advance' | 'credit' | 'tds';

/** One line on the bill's payments list. Cash receipts stay in `payments`; this adds advances, credit notes and TDS. */
export type InvoiceSettlement = {
  id: string;
  kind: InvoiceSettlementKind;
  label: string;
  amount: number;
  date: string | null;
  detail: string | null;
  payment_mode: string | null;
};

function modeLabel(mode: unknown): string {
  const raw = String(mode || '').replace(/_/g, ' ').trim();
  if (!raw) return 'Payment';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function asDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : String(value);
}

function dateRank(value: string | null): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Everything that reduced this invoice: receipts, customer-advance adjustments,
 * credit-note applications and TDS withheld. `settled_amount` matches the balance formula.
 */
export async function loadInvoiceSettlements(
  pool: Pool,
  invoice: {
    id: string;
    business_id: string;
    paid_amount?: unknown;
    advance_adjusted?: unknown;
    tds_received?: unknown;
    invoice_date?: unknown;
  },
  payments: Array<Record<string, unknown>>
): Promise<{ settlements: InvoiceSettlement[]; settled_amount: number; credit_applied: number }> {
  const tables = await pool.query(
    `SELECT to_regclass('public.advance_adjustments') AS advances,
            to_regclass('public.credit_note_applications') AS credits`
  );
  const hasAdvances = !!tables.rows[0]?.advances;
  const hasCredits = !!tables.rows[0]?.credits;

  const advanceRows = hasAdvances
    ? (
        await pool.query(
          `SELECT aa.id::text AS id,
                  aa.amount,
                  aa.adjustment_date::text AS adjustment_date,
                  NULLIF(aa.voucher_number, '') AS voucher_number
             FROM advance_adjustments aa
            WHERE aa.invoice_id = $1
              AND aa.business_id = $2
              AND aa.reversed_at IS NULL
            ORDER BY aa.adjustment_date DESC, aa.created_at DESC`,
          [invoice.id, invoice.business_id]
        )
      ).rows
    : [];

  const creditRows = hasCredits
    ? (
        await pool.query(
          `SELECT cna.id::text AS id,
                  cna.amount,
                  to_char(cna.created_at, 'YYYY-MM-DD') AS applied_on,
                  NULLIF(cn.credit_note_number, '') AS credit_note_number
             FROM credit_note_applications cna
             JOIN credit_notes cn
               ON cn.id = cna.credit_note_id
              AND cn.business_id = cna.business_id
            WHERE cna.invoice_id = $1
              AND cna.business_id = $2
              AND cna.reversed_at IS NULL
            ORDER BY cna.created_at DESC`,
          [invoice.id, invoice.business_id]
        )
      ).rows
    : [];

  const settlements: InvoiceSettlement[] = payments.map((p) => ({
    id: String(p.id),
    kind: 'payment',
    label: modeLabel(p.payment_mode),
    amount: round2(Number(p.amount) || 0),
    date: asDate(p.payment_date),
    detail: null,
    payment_mode: p.payment_mode == null ? null : String(p.payment_mode),
  }));

  for (const row of advanceRows) {
    settlements.push({
      id: String(row.id),
      kind: 'advance',
      label: 'Customer advance',
      amount: round2(Number(row.amount) || 0),
      date: asDate(row.adjustment_date),
      detail: row.voucher_number ? String(row.voucher_number) : null,
      payment_mode: null,
    });
  }

  let creditApplied = 0;
  for (const row of creditRows) {
    const amount = round2(Number(row.amount) || 0);
    creditApplied = round2(creditApplied + amount);
    settlements.push({
      id: String(row.id),
      kind: 'credit',
      label: 'Credit note',
      amount,
      date: asDate(row.applied_on),
      detail: row.credit_note_number ? String(row.credit_note_number) : null,
      payment_mode: null,
    });
  }

  const tds = round2(Number(invoice.tds_received) || 0);
  if (tds > 0) {
    settlements.push({
      id: `tds:${invoice.id}`,
      kind: 'tds',
      label: 'TDS withheld',
      amount: tds,
      date: asDate(invoice.invoice_date),
      detail: null,
      payment_mode: null,
    });
  }

  settlements.sort((a, b) => dateRank(b.date) - dateRank(a.date));

  const settledAmount = round2(
    (Number(invoice.paid_amount) || 0) +
      (Number(invoice.advance_adjusted) || 0) +
      tds +
      creditApplied
  );

  return { settlements, settled_amount: settledAmount, credit_applied: creditApplied };
}
