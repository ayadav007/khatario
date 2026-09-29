import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { insertVoucherLines, requireAccountByCode, round2, type VoucherLine } from '@/lib/accounting/voucher-posting';
import { toIsoDate } from '@/lib/gst/time-limits';

/**
 * s.16(2) second proviso / Rule 37: ITC on a supplier bill not paid within 180 days of the
 * invoice date is reversed in proportion to the unpaid value, and re-availed as it is paid.
 *
 * The position is kept by an idempotent sync per bill: the target reversal is
 * ITC × unpaid / bill value once 180 days have passed (0 before). The difference from what is
 * already reversed is posted as a new voucher —
 *   reversal     `itc_reversal_r37`  Dr ITC Suspense (1114) / Cr Input IGST/CGST/SGST/Cess
 *   re-availment `itc_reavail_r37`   Dr Input GST / Cr ITC Suspense
 * so the purchase and its balance are never altered and every step is an auditable voucher,
 * tagged `RULE37|<purchase_id>`. RCM bills are outside Rule 37 (tax is paid by the recipient).
 * Interest u/s 50 on reversed ITC that had been utilised is reported, not posted.
 */

export const RULE37_DAYS = 180;
export const RULE37_WARN_DAYS = 150;
export const RULE37_REVERSAL = 'itc_reversal_r37';
export const RULE37_REAVAIL = 'itc_reavail_r37';
const ITC_SUSPENSE = '1114';
const HEAD_ACCOUNTS = { igst: '1112', cgst: '1110', sgst: '1111', cess: '1113' } as const;
type Head = keyof typeof HEAD_ACCOUNTS;
export type ItcHeads = Record<Head, number>;

const ZERO: ItcHeads = { igst: 0, cgst: 0, sgst: 0, cess: 0 };

export function daysBetween(from: Date | string, to: Date | string): number {
  const a = Date.parse(`${toIsoDate(from)}T00:00:00Z`);
  const b = Date.parse(`${toIsoDate(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function rule37Status(billDate: Date | string, asOn: Date | string): 'within' | 'approaching' | 'overdue' {
  const d = daysBetween(billDate, asOn);
  if (d > RULE37_DAYS) return 'overdue';
  if (d >= RULE37_WARN_DAYS) return 'approaching';
  return 'within';
}

/** Target ITC reversed for a bill on `asOn` (proportional to the unpaid value). */
export function rule37TargetReversal(p: {
  itc: ItcHeads;
  grandTotal: number;
  unpaid: number;
  billDate: Date | string;
  asOn: Date | string;
}): ItcHeads {
  if (rule37Status(p.billDate, p.asOn) !== 'overdue' || !(p.grandTotal > 0)) return { ...ZERO };
  const share = Math.min(1, Math.max(0, p.unpaid / p.grandTotal));
  return {
    igst: round2(p.itc.igst * share),
    cgst: round2(p.itc.cgst * share),
    sgst: round2(p.itc.sgst * share),
    cess: round2(p.itc.cess * share),
  };
}

/** Simple interest u/s 50(3) at 18% p.a. from the day after the bill to `asOn`, on the amount reversed. */
export function rule37Interest(reversed: number, billDate: Date | string, asOn: Date | string): number {
  const days = Math.max(0, daysBetween(billDate, asOn));
  return round2((reversed * 0.18 * days) / 365);
}

export interface Rule37Row {
  purchase_id: string;
  bill_number: string | null;
  bill_date: string;
  supplier_id: string | null;
  branch_id: string | null;
  days_outstanding: number;
  status: 'within' | 'approaching' | 'overdue';
  grand_total: number;
  unpaid: number;
  itc_claimed: ItcHeads;
  target_reversal: ItcHeads;
  already_reversed: ItcHeads;
  interest_if_utilised: number;
}

/** Bills approaching / past 180 days with ITC at stake, plus bills that still carry a reversal. */
export async function listRule37Exposure(
  client: PoolClient,
  p: { businessId: string; asOn: string; branchId?: string | null; includeWithin?: boolean }
): Promise<Rule37Row[]> {
  const { rows } = await client.query(
    `WITH bills AS (
       SELECT pu.id, pu.bill_number, pu.bill_date, pu.supplier_id, pu.branch_id,
              COALESCE(pu.grand_total, 0) AS grand_total,
              GREATEST(COALESCE(pu.balance_amount, pu.grand_total - COALESCE(pu.paid_amount, 0)), 0) AS unpaid,
              COALESCE(pu.igst_total, 0) AS igst, COALESCE(pu.cgst_total, 0) AS cgst,
              COALESCE(pu.sgst_total, 0) AS sgst, COALESCE(pu.cess_total, 0) AS cess
         FROM purchases pu
        WHERE pu.business_id = $1::uuid
          AND pu.deleted_at IS NULL
          AND COALESCE(pu.status, '') NOT IN ('draft', 'cancelled')
          AND pu.itc_eligible IS DISTINCT FROM false
          AND COALESCE(pu.is_reverse_charge, false) = false
          AND pu.bill_date <= $2::date
          AND ($3::uuid IS NULL OR pu.branch_id = $3::uuid)
     ),
     rev AS (
       SELECT split_part(l.reference_number, '|', 2) AS purchase_id, a.account_code,
              SUM(l.credit - l.debit) AS amt
         FROM ledger_entry_lines l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.business_id = $1::uuid
          AND l.voucher_type IN ('${RULE37_REVERSAL}', '${RULE37_REAVAIL}')
          AND a.account_code IN ('1110', '1111', '1112', '1113')
        GROUP BY 1, 2
     )
     SELECT b.*,
            COALESCE(MAX(CASE WHEN r.account_code = '1112' THEN r.amt END), 0) AS rev_igst,
            COALESCE(MAX(CASE WHEN r.account_code = '1110' THEN r.amt END), 0) AS rev_cgst,
            COALESCE(MAX(CASE WHEN r.account_code = '1111' THEN r.amt END), 0) AS rev_sgst,
            COALESCE(MAX(CASE WHEN r.account_code = '1113' THEN r.amt END), 0) AS rev_cess
       FROM bills b
       LEFT JOIN rev r ON r.purchase_id = b.id::text
      GROUP BY b.id, b.bill_number, b.bill_date, b.supplier_id, b.branch_id, b.grand_total, b.unpaid,
               b.igst, b.cgst, b.sgst, b.cess`,
    [p.businessId, p.asOn, p.branchId ?? null]
  );

  const out: Rule37Row[] = [];
  for (const r of rows) {
    const itc: ItcHeads = { igst: Number(r.igst), cgst: Number(r.cgst), sgst: Number(r.sgst), cess: Number(r.cess) };
    const already: ItcHeads = {
      igst: round2(Number(r.rev_igst)),
      cgst: round2(Number(r.rev_cgst)),
      sgst: round2(Number(r.rev_sgst)),
      cess: round2(Number(r.rev_cess)),
    };
    const itcTotal = itc.igst + itc.cgst + itc.sgst + itc.cess;
    const alreadyTotal = already.igst + already.cgst + already.sgst + already.cess;
    const unpaid = Number(r.unpaid);
    const status = rule37Status(r.bill_date, p.asOn);
    if (itcTotal < 0.005) continue;
    if (alreadyTotal < 0.005 && (unpaid < 0.005 || (status === 'within' && !p.includeWithin))) continue;
    const target = rule37TargetReversal({ itc, grandTotal: Number(r.grand_total), unpaid, billDate: r.bill_date, asOn: p.asOn });
    out.push({
      purchase_id: r.id,
      bill_number: r.bill_number,
      bill_date: toIsoDate(r.bill_date),
      supplier_id: r.supplier_id,
      branch_id: r.branch_id,
      days_outstanding: daysBetween(r.bill_date, p.asOn),
      status,
      grand_total: Number(r.grand_total),
      unpaid,
      itc_claimed: itc,
      target_reversal: target,
      already_reversed: already,
      interest_if_utilised: rule37Interest(target.igst + target.cgst + target.sgst + target.cess, r.bill_date, p.asOn),
    });
  }
  return out.sort((a, b) => b.days_outstanding - a.days_outstanding);
}

/** Post the difference between target and already-reversed ITC for one bill. Caller owns the transaction. */
export async function syncRule37ForBill(
  client: PoolClient,
  p: { businessId: string; row: Rule37Row; entryDate: string }
): Promise<{ reversed: number; reavailed: number }> {
  const { row } = p;
  const delta = {} as ItcHeads;
  for (const h of Object.keys(HEAD_ACCOUNTS) as Head[]) {
    delta[h] = round2(row.target_reversal[h] - row.already_reversed[h]);
  }
  const suspense = await requireAccountByCode(client, p.businessId, ITC_SUSPENSE, 'ITC Suspense');
  const ref = `RULE37|${row.purchase_id}`;
  const label = `Rule 37 (180 days unpaid) - bill ${row.bill_number ?? row.purchase_id}`;

  const post = async (kind: 'reverse' | 'reavail') => {
    const lines: VoucherLine[] = [];
    let total = 0;
    for (const h of Object.keys(HEAD_ACCOUNTS) as Head[]) {
      const amt = kind === 'reverse' ? delta[h] : -delta[h];
      if (amt < 0.005) continue;
      const acc = await requireAccountByCode(client, p.businessId, HEAD_ACCOUNTS[h], `Input ${h.toUpperCase()}`);
      lines.push(
        kind === 'reverse'
          ? { accountId: acc, debit: 0, credit: amt, narration: `ITC reversed: ${label}` }
          : { accountId: acc, debit: amt, credit: 0, narration: `ITC re-availed on payment: ${label}` }
      );
      total = round2(total + amt);
    }
    if (total < 0.005) return 0;
    lines.push(
      kind === 'reverse'
        ? { accountId: suspense, debit: total, credit: 0, narration: `ITC reversed: ${label}` }
        : { accountId: suspense, debit: 0, credit: total, narration: `ITC re-availed on payment: ${label}` }
    );
    await insertVoucherLines(client, {
      businessId: p.businessId,
      branchId: row.branch_id,
      voucherId: randomUUID(),
      voucherType: kind === 'reverse' ? RULE37_REVERSAL : RULE37_REAVAIL,
      entryDate: p.entryDate,
      reference: ref,
      lines,
    });
    return total;
  };

  const reversed = await post('reverse');
  const reavailed = await post('reavail');
  return { reversed, reavailed };
}
