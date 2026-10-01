import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { createLedgerEntryLine, getAccountByCode } from '@/lib/ledger-utils';
import { activeLedgerLineSql, reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import {
  computeItcUtilizationDisplay,
  getItcFromInputLedgerNet,
  getLedgerNetCreditMinusDebit,
  GSTR3B_INPUT_CESS,
  GSTR3B_INPUT_CGST,
  GSTR3B_INPUT_IGST,
  GSTR3B_INPUT_SGST,
  GSTR3B_OUTPUT_CESS,
  GSTR3B_OUTPUT_CGST,
  GSTR3B_OUTPUT_IGST,
  GSTR3B_OUTPUT_SGST,
  GSTR3B_RCM_CGST,
  GSTR3B_RCM_IGST,
  GSTR3B_RCM_OUTPUT,
  GSTR3B_RCM_SGST,
  round2,
} from '@/lib/gst/gstr3b-ledger';
import { calendarMonthBounds, lockGstPeriod } from '@/lib/gst/gst-period-lock';

const BANK_DEFAULT_CODE = '1102';

export const GST_TAX_HEADS = ['IGST', 'CGST', 'SGST', 'CESS', 'RCM', 'RCM_IGST', 'RCM_CGST', 'RCM_SGST'] as const;
export type GstTaxHead = (typeof GST_TAX_HEADS)[number];

function isRcmHead(head: GstTaxHead): boolean {
  return head === 'RCM' || head.startsWith('RCM_');
}

export interface GstSetoffSummary {
  igst_to_igst: number;
  igst_to_cgst: number;
  igst_to_sgst: number;
  cgst_to_cgst: number;
  cgst_to_igst: number;
  sgst_to_sgst: number;
  sgst_to_igst: number;
  cess_to_cess: number;
}

const EMPTY_SETOFF: GstSetoffSummary = {
  igst_to_igst: 0,
  igst_to_cgst: 0,
  igst_to_sgst: 0,
  cgst_to_cgst: 0,
  cgst_to_igst: 0,
  sgst_to_sgst: 0,
  sgst_to_igst: 0,
  cess_to_cess: 0,
};

export interface ApplyGstSetoffParams {
  businessId: string;
  /** Period start (inclusive), YYYY-MM-DD — used by `mode: period` and for legacy duplicate overlap */
  from: string;
  /** Period end (inclusive), YYYY-MM-DD */
  to: string;
  branchId: string;
  /** Journal date; defaults to `to` */
  entryDate?: string;
  narrationPrefix?: string;
  /** Default `balance` (as-on-date ledger). `period` keeps prior period-net behaviour. */
  mode?: 'period' | 'balance';
  /** Calendar month YYYY-MM; defaults to month of `as_on_date` / `to` */
  gst_period?: string;
  /** As-on-date for balance mode; defaults to `entryDate` ?? `to` */
  as_on_date?: string;
  /** After a successful post, lock the GST month in `period_locks` (default true) */
  lock_period_after?: boolean;
  /** Stored on `period_locks.locked_by` when locking */
  locked_by?: string | null;
}

export interface ApplyGstSetoffResult {
  posted: boolean;
  voucherId?: string;
  gst_setoff_summary: GstSetoffSummary;
  referenceNumber: string;
  message?: string;
  reason?: string;
  warnings?: string[];
  gst_period?: string;
  mode?: 'period' | 'balance';
  period_lock?: { locked: boolean; warning?: string };
}

export interface RecordGstPaymentParams {
  businessId: string;
  branchId: string;
  amount: number;
  taxHead: GstTaxHead;
  paymentDate: string;
  /** Ledger account UUID for bank; if omitted, uses account code 1102 */
  bankAccountId?: string;
  challanNumber?: string;
  /** For RCM (2155), only `cash` is allowed (GST law — ITC cannot discharge RCM). */
  paymentMode?: string;
  /**
   * Cash-ledger head when `taxHead` is pooled RCM (`2155`).
   * Omitted → IGST `1130`. `CGST` → `1131`. `SGST` → `1132`. Cess is rejected.
   * Ignored for every other tax head (the head selects its own cash ledger).
   */
  cashHead?: string;
  narrationPrefix?: string;
}

export interface RecordGstPaymentResult {
  voucherId: string;
  /** Set on new one-shot payments (deposit + utilisation). Absent on nothing — always set for new posts. */
  deposit_voucher_id: string;
  challan_details: {
    challan_number: string | null;
    payment_date: string;
    tax_head: GstTaxHead;
    payment_mode: string | null;
    /** Cash-ledger account credited on utilisation. For pooled RCM this is 1130 unless cash_head says otherwise. */
    cash_account_code: string;
  };
}

export interface OutstandingGstParams {
  businessId: string;
  asOnDate: string;
  /** Pass branch UUID for branch balance; `null` for consolidated (all branches). */
  branchId: string | null;
}

export interface OutstandingGstResult {
  as_on_date: string;
  /** Ledger balances from get_account_balance (liability = positive when tax is owed). */
  output_igst: number;
  output_cgst: number;
  output_sgst: number;
  output_cess: number;
  rcm_output_2155: number;
  /** Head-wise RCM (2156–2158) when those accounts exist; 0 otherwise. */
  rcm_output_split: number;
  total_liability: number;
}

/**
 * Electronic cash ledger (asset). Not a second balance table — balances are `get_account_balance`.
 * Pooled RCM liability is 2155 and has no cash account of its own. A payment of 2155 credits one of
 * 1130 (IGST), 1131 (CGST), or 1132 (SGST). When `cash_head` is omitted the head is IGST (1130).
 * Cess (1133) cannot pay 2155. Split RCM uses the matching head: 2158→1130, 2156→1131, 2157→1132.
 */
export const GST_ECL_IGST = '1130';
export const GST_ECL_CGST = '1131';
export const GST_ECL_SGST = '1132';
export const GST_ECL_CESS = '1133';
export const GST_ECL_ACCOUNT_CODES = [GST_ECL_IGST, GST_ECL_CGST, GST_ECL_SGST, GST_ECL_CESS] as const;
/** Used when paying pooled RCM (2155) and the caller does not name a cash head. */
export const POOLED_RCM_CASH_LEDGER_CODE = GST_ECL_IGST;

export const GST_CASH_DEPOSIT_VOUCHER = 'gst_cash_deposit' as const;
export const GST_CASH_UTILIZATION_VOUCHER = 'gst_cash_utilization' as const;
/** Liability debits that count as tax paid. Deposits are not included. */
export const GST_CASH_DISCHARGE_VOUCHER_TYPES = ['gst_payment', 'gst_cash_utilization'] as const;

export type GstCashHead = 'IGST' | 'CGST' | 'SGST' | 'CESS';

export class GstCashLedgerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GstCashLedgerError';
    this.status = status;
  }
}

/** Liability accounts that receive Dr on cash discharge (`gst_payment` or `gst_cash_utilization`). */
export const GST_PAYMENT_LIABILITY_ACCOUNT_CODES: readonly string[] = [
  GSTR3B_OUTPUT_IGST,
  GSTR3B_OUTPUT_CGST,
  GSTR3B_OUTPUT_SGST,
  GSTR3B_OUTPUT_CESS,
  GSTR3B_RCM_OUTPUT,
  GSTR3B_RCM_CGST,
  GSTR3B_RCM_SGST,
  GSTR3B_RCM_IGST,
];

export interface GstPaymentEvent {
  date: string;
  /** Total cash GST paid that day (all heads), INR. */
  amount: number;
}

export interface GetGstPaymentEventsParams {
  businessId: string;
  branchId: string;
  /** Only lines with entry_date **strictly after** this (YYYY-MM-DD), e.g. GST due date. */
  afterDateExclusive: string;
  uptoDate: string;
}

/**
 * Chronological cash GST payments: liability debits on historical `gst_payment` and new
 * `gst_cash_utilization`. Deposits (`gst_cash_deposit`) and ITC (`gst_setoff`) are not tax paid.
 * `uptoDate` is an inclusive hard cap at the SQL layer (`entry_date <= uptoDate`).
 */
export async function getGstPaymentEvents(params: GetGstPaymentEventsParams): Promise<GstPaymentEvent[]> {
  const { businessId, branchId, afterDateExclusive, uptoDate } = params;
  const pool = getPool();
  const { rows } = await pool.query<{ d: string; amt: string }>(
    `
    SELECT lel.entry_date::date AS d, SUM(lel.debit)::text AS amt
    FROM ledger_entry_lines lel
    INNER JOIN accounts a ON a.id = lel.account_id AND a.business_id = lel.business_id
    WHERE lel.business_id = $1::uuid
      AND lel.branch_id = $2::uuid
      AND lel.voucher_type = ANY($6::text[])
      AND a.account_code = ANY($5::text[])
      AND lel.entry_date > $3::date
      AND lel.entry_date <= $4::date
      AND lel.debit > 0
    GROUP BY lel.entry_date::date
    ORDER BY lel.entry_date::date ASC
    `,
    [
      businessId,
      branchId,
      afterDateExclusive,
      uptoDate,
      [...GST_PAYMENT_LIABILITY_ACCOUNT_CODES],
      [...GST_CASH_DISCHARGE_VOUCHER_TYPES],
    ]
  );
  return rows.map((r) => ({
    date: typeof r.d === 'string' ? r.d.slice(0, 10) : String(r.d).slice(0, 10),
    amount: round2(parseFloat(r.amt ?? '0')),
  }));
}

export interface GstCashPaidLine {
  voucher_type: string;
  /** Liability account debited (2150–2158). */
  liability_account_code: string;
  debit: number;
  /**
   * Electronic cash ledger account credited on the same voucher.
   * Used only to place pooled RCM (2155) on IGST, CGST, or SGST.
   */
  cash_account_code?: string | null;
}

export interface GstCashPaidByHead {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

const EMPTY_CASH_PAID: GstCashPaidByHead = { igst: 0, cgst: 0, sgst: 0, cess: 0 };

/**
 * Table 9 cash by head from discharge lines only.
 * `gst_payment` and `gst_cash_utilization` count. Deposits, ITC set-off, and liability credits do not.
 * Pooled RCM (2155) follows the cash ledger credited on that voucher (1130 / 1131 / 1132).
 * A historical `gst_payment` on 2155 has no cash-ledger line, so it uses IGST `1130`, the same default as a one-shot payment.
 */
export function allocateGstCashPaidByHead(lines: GstCashPaidLine[]): GstCashPaidByHead {
  const out: GstCashPaidByHead = { ...EMPTY_CASH_PAID };
  const discharge = new Set<string>(GST_CASH_DISCHARGE_VOUCHER_TYPES);
  for (const line of lines) {
    if (!discharge.has(line.voucher_type)) continue;
    const debit = round2(Number(line.debit) || 0);
    if (debit < 0.005) continue;
    const head = cashPaidHead(line);
    if (!head) continue;
    out[head] = round2(out[head] + debit);
  }
  return out;
}

function cashPaidHead(line: GstCashPaidLine): keyof GstCashPaidByHead | null {
  switch (line.liability_account_code) {
    case GSTR3B_OUTPUT_IGST:
    case GSTR3B_RCM_IGST:
      return 'igst';
    case GSTR3B_OUTPUT_CGST:
    case GSTR3B_RCM_CGST:
      return 'cgst';
    case GSTR3B_OUTPUT_SGST:
    case GSTR3B_RCM_SGST:
      return 'sgst';
    case GSTR3B_OUTPUT_CESS:
      return 'cess';
    case GSTR3B_RCM_OUTPUT: {
      if (line.cash_account_code === GST_ECL_CGST) return 'cgst';
      if (line.cash_account_code === GST_ECL_SGST) return 'sgst';
      if (line.cash_account_code === GST_ECL_CESS) return null;
      return 'igst';
    }
    default:
      return null;
  }
}

/**
 * Cash tax paid in a date range, split by GST head. Same vouchers as {@link getGstPaymentEvents}.
 * Reversed lines are omitted. Business-wide when `branchId` is omitted (GSTR-9 has no branch).
 */
export async function getGstCashPaidByHead(params: {
  businessId: string;
  fromDate: string;
  toDate: string;
  branchId?: string | null;
}): Promise<GstCashPaidByHead> {
  const pool = getPool();
  const branchSql = params.branchId ? 'AND lel.branch_id = $6::uuid' : '';
  const queryParams: unknown[] = [
    params.businessId,
    params.fromDate,
    params.toDate,
    [...GST_CASH_DISCHARGE_VOUCHER_TYPES],
    [...GST_PAYMENT_LIABILITY_ACCOUNT_CODES],
  ];
  if (params.branchId) queryParams.push(params.branchId);
  const { rows } = await pool.query<{
    voucher_type: string;
    liability_account_code: string;
    debit: string;
    cash_account_code: string | null;
  }>(
    `
    SELECT lel.voucher_type,
           a.account_code AS liability_account_code,
           lel.debit::text AS debit,
           cash.account_code AS cash_account_code
    FROM ledger_entry_lines lel
    INNER JOIN accounts a ON a.id = lel.account_id AND a.business_id = lel.business_id
    LEFT JOIN LATERAL (
      SELECT ca.account_code
      FROM ledger_entry_lines cel
      INNER JOIN accounts ca ON ca.id = cel.account_id AND ca.business_id = cel.business_id
      WHERE cel.business_id = lel.business_id
        AND cel.voucher_id = lel.voucher_id
        AND cel.voucher_type = lel.voucher_type
        AND cel.credit > 0
        AND ca.account_code = ANY($${params.branchId ? '7' : '6'}::text[])
        AND ${activeLedgerLineSql('cel')}
      LIMIT 1
    ) cash ON true
    WHERE lel.business_id = $1::uuid
      AND lel.entry_date >= $2::date
      AND lel.entry_date <= $3::date
      AND lel.voucher_type = ANY($4::text[])
      AND a.account_code = ANY($5::text[])
      AND lel.debit > 0
      AND ${activeLedgerLineSql('lel')}
      ${branchSql}
    `,
    [...queryParams, [...GST_ECL_ACCOUNT_CODES]]
  );
  return allocateGstCashPaidByHead(
    rows.map((r) => ({
      voucher_type: r.voucher_type,
      liability_account_code: r.liability_account_code,
      debit: parseFloat(r.debit ?? '0'),
      cash_account_code: r.cash_account_code,
    }))
  );
}

function normalizeGstPeriod(fromIsoDate: string): string {
  return fromIsoDate.trim().slice(0, 7);
}

/** ITC pool from as-on-date balance on input (debit-nature) accounts: max(0, debit − credit in balance terms). */
export function getItcFromInputBalance(accountBalance: number): number {
  return Math.max(0, round2(accountBalance));
}

/**
 * Ledger balance as at date (same as outstanding GST / `get_account_balance`).
 */
export async function getGstBalance(
  businessId: string,
  accountCode: string,
  asOnDate: string,
  branchId: string
): Promise<number> {
  const acc = await getAccountByCode(businessId, accountCode);
  if (!acc) return 0;
  const pool = getPool();
  const { rows } = await pool.query<{ b: string }>(
    `SELECT get_account_balance($1::uuid, $2::uuid, $3::date, $4::uuid) AS b`,
    [acc.id, businessId, asOnDate, branchId]
  );
  return round2(parseFloat(rows[0]?.b ?? '0'));
}

/**
 * One GST set-off per branch per `gst_period` (YYYY-MM). Matches new refs `GST_SETOFF|YYYY-MM|…`
 * and legacy `GST_SETOFF|from|to` when that range overlaps the calendar month.
 */
async function assertNoGstSetoffForPeriod(
  client: PoolClient,
  businessId: string,
  branchId: string,
  gstPeriod: string,
  monthStart: string,
  monthEnd: string
): Promise<void> {
  const { rows } = await client.query(
    `
    SELECT 1
    FROM ledger_entry_lines
    WHERE business_id = $1::uuid
      AND branch_id = $2::uuid
      AND voucher_type = 'gst_setoff'
      AND (
        reference_number LIKE $3
        OR (
          reference_number ~ '^GST_SETOFF\\|[0-9]{4}-[0-9]{2}-[0-9]{2}\\|[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND split_part(reference_number, '|', 2)::date <= $5::date
          AND split_part(reference_number, '|', 3)::date >= $4::date
        )
      )
    LIMIT 1
    `,
    [businessId, branchId, `GST_SETOFF|${gstPeriod}|%`, monthStart, monthEnd]
  );
  if (rows.length > 0) {
    throw new Error('GST already settled for this period');
  }
}

/**
 * True if a `gst_setoff` voucher exists for the calendar month (new `GST_SETOFF|YYYY-MM|…` or legacy date-range refs).
 */
export async function gstSetoffExistsForPeriod(
  businessId: string,
  branchId: string,
  gstPeriod: string
): Promise<boolean> {
  const { start: monthStart, end: monthEnd } = calendarMonthBounds(gstPeriod);
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM ledger_entry_lines
    WHERE business_id = $1::uuid
      AND branch_id = $2::uuid
      AND voucher_type = 'gst_setoff'
      AND (
        reference_number LIKE $3
        OR (
          reference_number ~ '^GST_SETOFF\\|[0-9]{4}-[0-9]{2}-[0-9]{2}\\|[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND split_part(reference_number, '|', 2)::date <= $5::date
          AND split_part(reference_number, '|', 3)::date >= $4::date
        )
      )
    LIMIT 1
    `,
    [businessId, branchId, `GST_SETOFF|${gstPeriod}|%`, monthStart, monthEnd]
  );
  return rows.length > 0;
}

function utilizationToLedgerPairs(util: GstSetoffSummary): Array<{
  outCode: string;
  inCode: string;
  amount: number;
  label: string;
}> {
  return [
    { outCode: GSTR3B_OUTPUT_IGST, inCode: GSTR3B_INPUT_IGST, amount: util.igst_to_igst, label: 'IGST ITC → IGST output' },
    { outCode: GSTR3B_OUTPUT_CGST, inCode: GSTR3B_INPUT_IGST, amount: util.igst_to_cgst, label: 'IGST ITC → CGST output' },
    { outCode: GSTR3B_OUTPUT_SGST, inCode: GSTR3B_INPUT_IGST, amount: util.igst_to_sgst, label: 'IGST ITC → SGST output' },
    { outCode: GSTR3B_OUTPUT_CGST, inCode: GSTR3B_INPUT_CGST, amount: util.cgst_to_cgst, label: 'CGST ITC → CGST output' },
    { outCode: GSTR3B_OUTPUT_IGST, inCode: GSTR3B_INPUT_CGST, amount: util.cgst_to_igst, label: 'CGST ITC → IGST output' },
    { outCode: GSTR3B_OUTPUT_SGST, inCode: GSTR3B_INPUT_SGST, amount: util.sgst_to_sgst, label: 'SGST ITC → SGST output' },
    { outCode: GSTR3B_OUTPUT_IGST, inCode: GSTR3B_INPUT_SGST, amount: util.sgst_to_igst, label: 'SGST ITC → IGST output' },
    { outCode: GSTR3B_OUTPUT_CESS, inCode: GSTR3B_INPUT_CESS, amount: util.cess_to_cess, label: 'Cess ITC → Cess output' },
  ].filter((p) => p.amount >= 0.005);
}

export { utilizationToLedgerPairs };

/**
 * Post statutory GST ITC set-off: Dr Output GST (reduce liability), Cr Input GST (reduce ITC).
 * Voucher type `gst_setoff`. One set-off per branch per `gst_period` (YYYY-MM).
 */
export async function applyGstSetoff(params: ApplyGstSetoffParams): Promise<ApplyGstSetoffResult> {
  const { businessId, from, to, branchId } = params;
  const mode = params.mode ?? 'balance';
  const entryDate = params.entryDate ?? to;
  const asOnDate = params.as_on_date ?? entryDate;
  const narrationBase = params.narrationPrefix ?? 'GST ITC utilization';
  const warnings: string[] = [];
  if (mode === 'period') {
    warnings.push('Using period-based set-off (may cause carry-forward mismatch)');
  }

  const gst_period =
    params.gst_period?.trim() ||
    normalizeGstPeriod(asOnDate.length >= 7 ? asOnDate : to);
  if (!/^\d{4}-\d{2}$/.test(gst_period)) {
    throw new Error('gst_period must be YYYY-MM');
  }

  const { start: monthStart, end: monthEnd } = calendarMonthBounds(gst_period);

  let outputIGST: number;
  let outputCGST: number;
  let outputSGST: number;
  let itcIGST: number;
  let itcCGST: number;
  let itcSGST: number;
  let outputCess: number;
  let itcCess: number;

  if (mode === 'balance') {
    outputCess = Math.max(0, round2(await getGstBalance(businessId, GSTR3B_OUTPUT_CESS, asOnDate, branchId)));
    itcCess = getItcFromInputBalance(await getGstBalance(businessId, GSTR3B_INPUT_CESS, asOnDate, branchId));
    const rawOutI = await getGstBalance(businessId, GSTR3B_OUTPUT_IGST, asOnDate, branchId);
    const rawOutC = await getGstBalance(businessId, GSTR3B_OUTPUT_CGST, asOnDate, branchId);
    const rawOutS = await getGstBalance(businessId, GSTR3B_OUTPUT_SGST, asOnDate, branchId);
    outputIGST = Math.max(0, round2(rawOutI));
    outputCGST = Math.max(0, round2(rawOutC));
    outputSGST = Math.max(0, round2(rawOutS));

    const balI = await getGstBalance(businessId, GSTR3B_INPUT_IGST, asOnDate, branchId);
    const balC = await getGstBalance(businessId, GSTR3B_INPUT_CGST, asOnDate, branchId);
    const balS = await getGstBalance(businessId, GSTR3B_INPUT_SGST, asOnDate, branchId);
    itcIGST = getItcFromInputBalance(balI);
    itcCGST = getItcFromInputBalance(balC);
    itcSGST = getItcFromInputBalance(balS);
  } else {
    outputCess = round2(await getLedgerNetCreditMinusDebit(businessId, GSTR3B_OUTPUT_CESS, from, to, branchId));
    itcCess = getItcFromInputLedgerNet(
      await getLedgerNetCreditMinusDebit(businessId, GSTR3B_INPUT_CESS, from, to, branchId)
    );
    outputIGST = round2(
      await getLedgerNetCreditMinusDebit(businessId, GSTR3B_OUTPUT_IGST, from, to, branchId)
    );
    outputCGST = round2(
      await getLedgerNetCreditMinusDebit(businessId, GSTR3B_OUTPUT_CGST, from, to, branchId)
    );
    outputSGST = round2(
      await getLedgerNetCreditMinusDebit(businessId, GSTR3B_OUTPUT_SGST, from, to, branchId)
    );

    const netIn1110 = await getLedgerNetCreditMinusDebit(businessId, GSTR3B_INPUT_CGST, from, to, branchId);
    const netIn1111 = await getLedgerNetCreditMinusDebit(businessId, GSTR3B_INPUT_SGST, from, to, branchId);
    const netIn1112 = await getLedgerNetCreditMinusDebit(businessId, GSTR3B_INPUT_IGST, from, to, branchId);

    itcCGST = getItcFromInputLedgerNet(netIn1110);
    itcSGST = getItcFromInputLedgerNet(netIn1111);
    itcIGST = getItcFromInputLedgerNet(netIn1112);
  }

  const outputTotal = round2(outputIGST + outputCGST + outputSGST + outputCess);
  const itcTotal = round2(itcIGST + itcCGST + itcSGST + itcCess);
  if (outputTotal < 0.005 && itcTotal < 0.005) {
    return {
      posted: false,
      reason: 'Nothing to settle',
      gst_setoff_summary: { ...EMPTY_SETOFF },
      referenceNumber: `GST_SETOFF|${gst_period}|${mode}`,
      warnings: warnings.length ? warnings : undefined,
      gst_period,
      mode,
    };
  }

  const util = computeItcUtilizationDisplay({
    igstLiability: round2(outputIGST),
    cgstLiability: round2(outputCGST),
    sgstLiability: round2(outputSGST),
    itcIgst: itcIGST,
    itcCgst: itcCGST,
    itcSgst: itcSGST,
    cessLiability: outputCess,
    itcCess,
  });

  const gst_setoff_summary: GstSetoffSummary = {
    igst_to_igst: util.igst_to_igst,
    igst_to_cgst: util.igst_to_cgst,
    igst_to_sgst: util.igst_to_sgst,
    cgst_to_cgst: util.cgst_to_cgst,
    cgst_to_igst: util.cgst_to_igst,
    sgst_to_sgst: util.sgst_to_sgst,
    sgst_to_igst: util.sgst_to_igst,
    cess_to_cess: util.cess_to_cess,
  };

  const pairs = utilizationToLedgerPairs(gst_setoff_summary);
  const referenceNumber = `GST_SETOFF|${gst_period}|${mode}`;

  if (pairs.length === 0) {
    return {
      posted: false,
      gst_setoff_summary,
      referenceNumber,
      message: 'No ITC utilization to post for this period (amounts round to zero).',
      warnings: warnings.length ? warnings : undefined,
      gst_period,
      mode,
    };
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertNoGstSetoffForPeriod(client, businessId, branchId, gst_period, monthStart, monthEnd);

    const voucherId = randomUUID();

    for (const p of pairs) {
      const outAcc = await getAccountByCode(businessId, p.outCode);
      const inAcc = await getAccountByCode(businessId, p.inCode);
      if (!outAcc) {
        throw new Error(`Output GST account ${p.outCode} not found for this business`);
      }
      if (!inAcc) {
        throw new Error(`Input GST account ${p.inCode} not found for this business`);
      }
      const amt = round2(p.amount);
      await createLedgerEntryLine({
        businessId,
        voucherId,
        voucherType: 'gst_setoff',
        accountId: outAcc.id,
        entryDate,
        debit: amt,
        credit: 0,
        narration: `${narrationBase}: ${p.label} (Dr output)`,
        referenceNumber,
        branchId,
        poolClient: client,
      });
      await createLedgerEntryLine({
        businessId,
        voucherId,
        voucherType: 'gst_setoff',
        accountId: inAcc.id,
        entryDate,
        debit: 0,
        credit: amt,
        narration: `${narrationBase}: ${p.label} (Cr ITC)`,
        referenceNumber,
        branchId,
        poolClient: client,
      });
    }

    await client.query('COMMIT');

    let period_lock: { locked: boolean; warning?: string } | undefined;
    if (params.lock_period_after !== false) {
      period_lock = await lockGstPeriod({
        businessId,
        branchId,
        period: gst_period,
        lockedBy: params.locked_by ?? null,
        notes: 'Locked after GST settlement',
      });
    }

    return {
      posted: true,
      voucherId,
      gst_setoff_summary,
      referenceNumber,
      warnings: warnings.length ? warnings : undefined,
      gst_period,
      mode,
      period_lock,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export function cashLedgerCodeForHead(head: GstCashHead): string {
  switch (head) {
    case 'IGST':
      return GST_ECL_IGST;
    case 'CGST':
      return GST_ECL_CGST;
    case 'SGST':
      return GST_ECL_SGST;
    case 'CESS':
      return GST_ECL_CESS;
    default:
      throw new GstCashLedgerError('GST head must be IGST, CGST, SGST, or CESS');
  }
}

export function gstCashHeadFromAccountCode(code: string): GstCashHead {
  switch (code) {
    case GST_ECL_IGST:
      return 'IGST';
    case GST_ECL_CGST:
      return 'CGST';
    case GST_ECL_SGST:
      return 'SGST';
    case GST_ECL_CESS:
      return 'CESS';
    default:
      throw new GstCashLedgerError(`Unknown electronic cash ledger account ${code}`);
  }
}

/**
 * Liability account and the electronic cash ledger account for a discharge.
 * Pooled RCM (`taxHead` `RCM`, account 2155) uses `cashHead`, defaulting to IGST 1130.
 */
export function resolveGstCashLedgerPosting(
  taxHead: GstTaxHead,
  cashHead?: string | null
): { cashCode: string; liabilityCode: string; cashHead: GstCashHead } {
  const liabilityCode = taxHeadToOutputCode(taxHead);
  if (taxHead === 'RCM') {
    const requested = (cashHead || '').trim().toUpperCase();
    if (requested === 'CESS') {
      throw new GstCashLedgerError(
        'Cess cash ledger (1133) cannot pay pooled RCM liability (2155). Use IGST (1130), CGST (1131), or SGST (1132).'
      );
    }
    if (requested === 'CGST') {
      return { cashCode: GST_ECL_CGST, liabilityCode, cashHead: 'CGST' };
    }
    if (requested === 'SGST') {
      return { cashCode: GST_ECL_SGST, liabilityCode, cashHead: 'SGST' };
    }
    if (requested === 'IGST' || requested === '') {
      return { cashCode: POOLED_RCM_CASH_LEDGER_CODE, liabilityCode, cashHead: 'IGST' };
    }
    throw new GstCashLedgerError('cash_head for pooled RCM (2155) must be IGST, CGST, or SGST.');
  }
  const cashCode =
    taxHead === 'IGST' || taxHead === 'RCM_IGST'
      ? GST_ECL_IGST
      : taxHead === 'CGST' || taxHead === 'RCM_CGST'
        ? GST_ECL_CGST
        : taxHead === 'SGST' || taxHead === 'RCM_SGST'
          ? GST_ECL_SGST
          : GST_ECL_CESS;
  return { cashCode, liabilityCode, cashHead: gstCashHeadFromAccountCode(cashCode) };
}

function taxHeadToOutputCode(head: GstTaxHead): string {
  switch (head) {
    case 'IGST':
      return GSTR3B_OUTPUT_IGST;
    case 'CGST':
      return GSTR3B_OUTPUT_CGST;
    case 'SGST':
      return GSTR3B_OUTPUT_SGST;
    case 'CESS':
      return GSTR3B_OUTPUT_CESS;
    case 'RCM':
      return GSTR3B_RCM_OUTPUT;
    case 'RCM_IGST':
      return GSTR3B_RCM_IGST;
    case 'RCM_CGST':
      return GSTR3B_RCM_CGST;
    case 'RCM_SGST':
      return GSTR3B_RCM_SGST;
    default:
      throw new Error(`Unknown tax head: ${head}`);
  }
}

function positiveAmount(raw: number): number {
  const amount = round2(Number(raw));
  if (amount < 0.005) {
    throw new GstCashLedgerError('Amount must be positive');
  }
  return amount;
}

async function requireAccount(businessId: string, code: string, label: string) {
  const acc = await getAccountByCode(businessId, code);
  if (!acc) {
    throw new GstCashLedgerError(`${label} account ${code} not found`);
  }
  return acc;
}

async function resolveBankAccountId(
  client: PoolClient,
  businessId: string,
  bankAccountId?: string
): Promise<string> {
  if (bankAccountId) {
    const { rows } = await client.query(
      `SELECT 1 FROM accounts WHERE id = $1::uuid AND business_id = $2::uuid LIMIT 1`,
      [bankAccountId, businessId]
    );
    if (rows.length === 0) {
      throw new GstCashLedgerError('bank_account_id does not belong to this business');
    }
    return bankAccountId;
  }
  const bank = await getAccountByCode(businessId, BANK_DEFAULT_CODE);
  if (!bank) {
    throw new GstCashLedgerError(
      `Bank account ${BANK_DEFAULT_CODE} not found — pass bankAccountId or create default bank`
    );
  }
  return bank.id;
}

async function cashBalanceOnClient(
  client: PoolClient,
  accountId: string,
  businessId: string,
  asOnDate: string,
  branchId: string
): Promise<number> {
  const { rows } = await client.query<{ b: string }>(
    `SELECT get_account_balance($1::uuid, $2::uuid, $3::date, $4::uuid) AS b`,
    [accountId, businessId, asOnDate, branchId]
  );
  return round2(parseFloat(rows[0]?.b ?? '0'));
}

export interface RecordGstCashDepositParams {
  businessId: string;
  branchId: string;
  amount: number;
  taxHead: GstCashHead;
  paymentDate: string;
  bankAccountId?: string;
  challanNumber?: string;
  narrationPrefix?: string;
}

export interface RecordGstCashDepositResult {
  voucherId: string;
  cash_account_code: string;
  reference_number: string;
}

async function writeGstCashDeposit(
  client: PoolClient,
  params: RecordGstCashDepositParams & { amount: number; bankAccountId: string }
): Promise<RecordGstCashDepositResult> {
  const cashCode = cashLedgerCodeForHead(params.taxHead);
  const cashAcc = await requireAccount(params.businessId, cashCode, 'Electronic cash ledger');
  const voucherId = randomUUID();
  const ref = params.challanNumber
    ? `GST_CASH_DEP|${params.challanNumber}|${params.taxHead}`
    : `GST_CASH_DEP|${voucherId.slice(0, 8)}|${params.taxHead}`;
  const narration = params.narrationPrefix ?? 'GST electronic cash ledger deposit';
  await createLedgerEntryLine({
    businessId: params.businessId,
    voucherId,
    voucherType: GST_CASH_DEPOSIT_VOUCHER,
    accountId: cashAcc.id,
    entryDate: params.paymentDate,
    debit: params.amount,
    credit: 0,
    narration: `${narration}: ${params.taxHead}`,
    referenceNumber: ref,
    branchId: params.branchId,
    poolClient: client,
  });
  await createLedgerEntryLine({
    businessId: params.businessId,
    voucherId,
    voucherType: GST_CASH_DEPOSIT_VOUCHER,
    accountId: params.bankAccountId,
    entryDate: params.paymentDate,
    debit: 0,
    credit: params.amount,
    narration: `${narration}: bank`,
    referenceNumber: ref,
    branchId: params.branchId,
    poolClient: client,
  });
  return { voucherId, cash_account_code: cashCode, reference_number: ref };
}

/**
 * Dr Electronic Cash Ledger / Cr Bank. Does not change GST liability.
 */
export async function recordGstCashDeposit(
  params: RecordGstCashDepositParams
): Promise<RecordGstCashDepositResult> {
  const amount = positiveAmount(params.amount);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bankAccountId = await resolveBankAccountId(client, params.businessId, params.bankAccountId);
    const result = await writeGstCashDeposit(client, { ...params, amount, bankAccountId });
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export interface RecordGstCashUtilizationParams {
  businessId: string;
  branchId: string;
  amount: number;
  taxHead: GstTaxHead;
  /** Required only to choose 1130/1131/1132 when taxHead is pooled RCM. */
  cashHead?: string;
  paymentDate: string;
  challanNumber?: string;
  narrationPrefix?: string;
}

export interface RecordGstCashUtilizationResult {
  voucherId: string;
  cash_account_code: string;
  liability_account_code: string;
  reference_number: string;
}

async function writeGstCashUtilization(
  client: PoolClient,
  params: RecordGstCashUtilizationParams & { amount: number }
): Promise<RecordGstCashUtilizationResult> {
  const posting = resolveGstCashLedgerPosting(params.taxHead, params.cashHead);
  const cashAcc = await requireAccount(params.businessId, posting.cashCode, 'Electronic cash ledger');
  const liabilityAcc = await requireAccount(params.businessId, posting.liabilityCode, 'GST liability');
  const available = await cashBalanceOnClient(
    client,
    cashAcc.id,
    params.businessId,
    params.paymentDate,
    params.branchId
  );
  if (available + 0.001 < params.amount) {
    throw new GstCashLedgerError(
      `Insufficient electronic cash ledger balance for ${posting.cashHead} (${posting.cashCode}). Available ₹${available.toFixed(2)}, requested ₹${params.amount.toFixed(2)}.`
    );
  }
  const voucherId = randomUUID();
  const ref = params.challanNumber
    ? `GST_CASH_USE|${params.challanNumber}|${params.taxHead}`
    : `GST_CASH_USE|${voucherId.slice(0, 8)}|${params.taxHead}`;
  const narration = params.narrationPrefix ?? 'GST electronic cash ledger utilisation';
  await createLedgerEntryLine({
    businessId: params.businessId,
    voucherId,
    voucherType: GST_CASH_UTILIZATION_VOUCHER,
    accountId: liabilityAcc.id,
    entryDate: params.paymentDate,
    debit: params.amount,
    credit: 0,
    narration: `${narration}: ${params.taxHead} liability`,
    referenceNumber: ref,
    branchId: params.branchId,
    poolClient: client,
  });
  await createLedgerEntryLine({
    businessId: params.businessId,
    voucherId,
    voucherType: GST_CASH_UTILIZATION_VOUCHER,
    accountId: cashAcc.id,
    entryDate: params.paymentDate,
    debit: 0,
    credit: params.amount,
    narration: `${narration}: ${posting.cashHead} cash ledger`,
    referenceNumber: ref,
    branchId: params.branchId,
    poolClient: client,
  });
  return {
    voucherId,
    cash_account_code: posting.cashCode,
    liability_account_code: posting.liabilityCode,
    reference_number: ref,
  };
}

/**
 * Dr GST liability / Cr Electronic Cash Ledger. Rejects amounts above the cash-ledger balance.
 */
export async function recordGstCashUtilization(
  params: RecordGstCashUtilizationParams
): Promise<RecordGstCashUtilizationResult> {
  const amount = positiveAmount(params.amount);
  if (isRcmHead(params.taxHead)) {
    resolveGstCashLedgerPosting(params.taxHead, params.cashHead);
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await writeGstCashUtilization(client, { ...params, amount });
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * One-shot challan: deposit then utilisation in one transaction.
 * Net books match a historical `gst_payment` (Dr liability / Cr bank). New rows use
 * `gst_cash_deposit` and `gst_cash_utilization`. `voucherId` is the utilisation voucher.
 */
export async function recordGstPayment(params: RecordGstPaymentParams): Promise<RecordGstPaymentResult> {
  const {
    businessId,
    branchId,
    taxHead,
    paymentDate,
    challanNumber,
    paymentMode,
    narrationPrefix,
    cashHead,
  } = params;

  if (isRcmHead(taxHead)) {
    const mode = (paymentMode || '').toLowerCase();
    if (mode === 'itc' || mode === 'itc_setoff' || mode === 'credit') {
      throw new Error('RCM cannot be paid using ITC — use bank/cash payment only.');
    }
  }

  const amount = round2(Number(params.amount));
  if (amount < 0.005) {
    throw new Error('Payment amount must be positive');
  }
  const posting = resolveGstCashLedgerPosting(taxHead, cashHead);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bankAccountId = await resolveBankAccountId(client, businessId, params.bankAccountId);
    const deposit = await writeGstCashDeposit(client, {
      businessId,
      branchId,
      amount,
      taxHead: posting.cashHead,
      paymentDate,
      bankAccountId,
      challanNumber,
      narrationPrefix: narrationPrefix ?? 'GST payment (challan)',
    });
    const utilized = await writeGstCashUtilization(client, {
      businessId,
      branchId,
      amount,
      taxHead,
      cashHead: posting.cashHead,
      paymentDate,
      challanNumber,
      narrationPrefix: narrationPrefix ?? 'GST payment (challan)',
    });
    await client.query('COMMIT');
    return {
      voucherId: utilized.voucherId,
      deposit_voucher_id: deposit.voucherId,
      challan_details: {
        challan_number: challanNumber ?? null,
        payment_date: paymentDate,
        tax_head: taxHead,
        payment_mode: paymentMode ?? null,
        cash_account_code: posting.cashCode,
      },
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function reverseGstCashLedgerVoucher(params: {
  businessId: string;
  branchId: string;
  voucherId: string;
  voucherType: typeof GST_CASH_DEPOSIT_VOUCHER | typeof GST_CASH_UTILIZATION_VOUCHER;
  reason: string;
  entryDate?: string;
  actorId?: string | null;
}): Promise<{ reversed_lines: number }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (params.voucherType === GST_CASH_DEPOSIT_VOUCHER) {
      await assertDepositReversalKeepsBalance(client, params.businessId, params.branchId, params.voucherId);
    }
    const reversed_lines = await reverseVoucherLedgerEntries(client, {
      businessId: params.businessId,
      voucherType: params.voucherType,
      voucherId: params.voucherId,
      reason: params.reason,
      entryDate: params.entryDate,
      actorId: params.actorId,
    });
    await client.query('COMMIT');
    return { reversed_lines };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function assertDepositReversalKeepsBalance(
  client: PoolClient,
  businessId: string,
  branchId: string,
  voucherId: string
): Promise<void> {
  const { rows } = await client.query<{ account_id: string; account_code: string; debit: string }>(
    `
    SELECT lel.account_id, a.account_code, SUM(lel.debit)::text AS debit
    FROM ledger_entry_lines lel
    INNER JOIN accounts a ON a.id = lel.account_id AND a.business_id = lel.business_id
    WHERE lel.business_id = $1::uuid
      AND lel.branch_id = $2::uuid
      AND lel.voucher_id = $3::uuid
      AND lel.voucher_type = $4
      AND a.account_code = ANY($5::text[])
      AND lel.debit > 0
      AND ${activeLedgerLineSql('lel')}
    GROUP BY lel.account_id, a.account_code
    `,
    [businessId, branchId, voucherId, GST_CASH_DEPOSIT_VOUCHER, [...GST_ECL_ACCOUNT_CODES]]
  );
  for (const row of rows) {
    const deposit = round2(parseFloat(row.debit ?? '0'));
    const balance = await cashBalanceOnClient(client, row.account_id, businessId, '9999-12-31', branchId);
    if (round2(balance - deposit) < -0.001) {
      throw new GstCashLedgerError(
        `Reverse the cash utilisation before reversing the deposit that funded it. ${row.account_code} balance is ₹${balance.toFixed(2)} and this deposit is ₹${deposit.toFixed(2)}.`
      );
    }
  }
}

export interface GstCashLedgerStatementLine {
  id: string;
  date: string;
  account_code: string;
  head: GstCashHead;
  voucher_type: string;
  voucher_id: string;
  debit: number;
  credit: number;
  running_balance: number;
  narration: string | null;
  reference_number: string | null;
}

export interface GstCashLedgerHead {
  cash_account_code: string;
  cash_balance: number;
  output_liability_account: string;
  output_liability: number;
  rcm_liability_account: string | null;
  rcm_liability: number;
}

export interface GstCashLedgerResult {
  as_on_date: string;
  branch_id: string | null;
  igst: GstCashLedgerHead;
  cgst: GstCashLedgerHead;
  sgst: GstCashLedgerHead;
  cess: GstCashLedgerHead;
  /** Pooled RCM (2155). Paid from 1130 unless a utilisation names CGST or SGST cash. */
  pooled_rcm: {
    liability_account: string;
    liability: number;
    cash_account_when_unspecified: string;
  };
  statement: GstCashLedgerStatementLine[];
}

export async function getGstCashLedger(params: {
  businessId: string;
  asOnDate: string;
  branchId: string | null;
}): Promise<GstCashLedgerResult> {
  const { businessId, asOnDate, branchId } = params;
  const outstanding = await getOutstandingGst({ businessId, asOnDate, branchId });
  const pool = getPool();

  async function bal(code: string): Promise<number> {
    const acc = await getAccountByCode(businessId, code);
    if (!acc) return 0;
    const { rows } = await pool.query<{ b: string }>(
      `SELECT get_account_balance($1::uuid, $2::uuid, $3::date, $4::uuid) AS b`,
      [acc.id, businessId, asOnDate, branchId]
    );
    return round2(parseFloat(rows[0]?.b ?? '0'));
  }

  const [igstCash, cgstCash, sgstCash, cessCash, rcmI, rcmC, rcmS] = await Promise.all([
    bal(GST_ECL_IGST),
    bal(GST_ECL_CGST),
    bal(GST_ECL_SGST),
    bal(GST_ECL_CESS),
    bal(GSTR3B_RCM_IGST),
    bal(GSTR3B_RCM_CGST),
    bal(GSTR3B_RCM_SGST),
  ]);

  const branchSql = branchId ? 'AND lel.branch_id = $4::uuid' : '';
  const paramsSql: unknown[] = [businessId, asOnDate, [...GST_ECL_ACCOUNT_CODES]];
  if (branchId) paramsSql.push(branchId);
  const { rows } = await pool.query<{
    id: string;
    d: string;
    account_code: string;
    voucher_type: string;
    voucher_id: string;
    debit: string;
    credit: string;
    narration: string | null;
    reference_number: string | null;
    opening_balance: string | null;
    opening_balance_type: string | null;
  }>(
    `
    SELECT lel.id::text AS id,
           lel.entry_date::date AS d,
           a.account_code,
           lel.voucher_type,
           lel.voucher_id::text AS voucher_id,
           lel.debit::text AS debit,
           lel.credit::text AS credit,
           lel.narration,
           lel.reference_number,
           a.opening_balance::text AS opening_balance,
           a.opening_balance_type
    FROM ledger_entry_lines lel
    INNER JOIN accounts a ON a.id = lel.account_id AND a.business_id = lel.business_id
    WHERE lel.business_id = $1::uuid
      AND lel.entry_date <= $2::date
      AND a.account_code = ANY($3::text[])
      ${branchSql}
    ORDER BY lel.entry_date, lel.created_at, lel.id
    `,
    paramsSql
  );

  const openingByCode = new Map<string, number>();
  if (rows.length === 0) {
    const openings = await pool.query<{ account_code: string; opening_balance: string; opening_balance_type: string }>(
      `SELECT account_code, opening_balance::text, opening_balance_type
       FROM accounts
       WHERE business_id = $1::uuid AND account_code = ANY($2::text[])`,
      [businessId, [...GST_ECL_ACCOUNT_CODES]]
    );
    for (const o of openings.rows) {
      const raw = round2(parseFloat(o.opening_balance ?? '0'));
      openingByCode.set(o.account_code, o.opening_balance_type === 'credit' ? -raw : raw);
    }
  }
  const running = new Map<string, number>();
  for (const code of GST_ECL_ACCOUNT_CODES) running.set(code, openingByCode.get(code) ?? 0);
  const seenOpening = new Set<string>();
  const statement: GstCashLedgerStatementLine[] = [];
  for (const row of rows) {
    if (!seenOpening.has(row.account_code)) {
      const raw = round2(parseFloat(row.opening_balance ?? '0'));
      running.set(row.account_code, row.opening_balance_type === 'credit' ? -raw : raw);
      seenOpening.add(row.account_code);
    }
    const debit = round2(parseFloat(row.debit ?? '0'));
    const credit = round2(parseFloat(row.credit ?? '0'));
    const next = round2((running.get(row.account_code) ?? 0) + debit - credit);
    running.set(row.account_code, next);
    statement.push({
      id: row.id,
      date: typeof row.d === 'string' ? row.d.slice(0, 10) : String(row.d).slice(0, 10),
      account_code: row.account_code,
      head: gstCashHeadFromAccountCode(row.account_code),
      voucher_type: row.voucher_type,
      voucher_id: row.voucher_id,
      debit,
      credit,
      running_balance: next,
      narration: row.narration,
      reference_number: row.reference_number,
    });
  }

  const head = (
    cashCode: string,
    cashBalance: number,
    outputCode: string,
    outputLiability: number,
    rcmCode: string | null,
    rcmLiability: number
  ): GstCashLedgerHead => ({
    cash_account_code: cashCode,
    cash_balance: cashBalance,
    output_liability_account: outputCode,
    output_liability: outputLiability,
    rcm_liability_account: rcmCode,
    rcm_liability: rcmLiability,
  });

  return {
    as_on_date: asOnDate,
    branch_id: branchId,
    igst: head(GST_ECL_IGST, igstCash, GSTR3B_OUTPUT_IGST, outstanding.output_igst, GSTR3B_RCM_IGST, rcmI),
    cgst: head(GST_ECL_CGST, cgstCash, GSTR3B_OUTPUT_CGST, outstanding.output_cgst, GSTR3B_RCM_CGST, rcmC),
    sgst: head(GST_ECL_SGST, sgstCash, GSTR3B_OUTPUT_SGST, outstanding.output_sgst, GSTR3B_RCM_SGST, rcmS),
    cess: head(GST_ECL_CESS, cessCash, GSTR3B_OUTPUT_CESS, outstanding.output_cess, null, 0),
    pooled_rcm: {
      liability_account: GSTR3B_RCM_OUTPUT,
      liability: outstanding.rcm_output_2155,
      cash_account_when_unspecified: POOLED_RCM_CASH_LEDGER_CODE,
    },
    statement,
  };
}

/**
 * Outstanding GST liability from the ledger as at a date (after all posted set-offs and payments).
 */
export async function getOutstandingGst(params: OutstandingGstParams): Promise<OutstandingGstResult> {
  const { businessId, asOnDate, branchId } = params;
  const pool = getPool();

  async function bal(code: string): Promise<number> {
    const acc = await getAccountByCode(businessId, code);
    if (!acc) return 0;
    const { rows } = await pool.query<{ b: string }>(
      `SELECT get_account_balance($1::uuid, $2::uuid, $3::date, $4::uuid) AS b`,
      [acc.id, businessId, asOnDate, branchId]
    );
    return round2(parseFloat(rows[0]?.b ?? '0'));
  }

  const output_igst = await bal(GSTR3B_OUTPUT_IGST);
  const output_cgst = await bal(GSTR3B_OUTPUT_CGST);
  const output_sgst = await bal(GSTR3B_OUTPUT_SGST);
  const output_cess = await bal(GSTR3B_OUTPUT_CESS);
  const rcm_output_2155 = await bal(GSTR3B_RCM_OUTPUT);
  const rcm_output_split = round2(
    (await bal(GSTR3B_RCM_CGST)) + (await bal(GSTR3B_RCM_SGST)) + (await bal(GSTR3B_RCM_IGST))
  );

  const total_liability = round2(
    output_igst + output_cgst + output_sgst + output_cess + rcm_output_2155 + rcm_output_split
  );

  return {
    as_on_date: asOnDate,
    output_igst,
    output_cgst,
    output_sgst,
    output_cess,
    rcm_output_2155,
    rcm_output_split,
    total_liability,
  };
}
