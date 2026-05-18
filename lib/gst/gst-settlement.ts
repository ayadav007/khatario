import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { createLedgerEntryLine, getAccountByCode } from '@/lib/ledger-utils';
import {
  computeItcUtilizationDisplay,
  getItcFromInputLedgerNet,
  getLedgerNetCreditMinusDebit,
  GSTR3B_INPUT_CGST,
  GSTR3B_INPUT_IGST,
  GSTR3B_INPUT_SGST,
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

export type GstTaxHead = 'IGST' | 'CGST' | 'SGST' | 'RCM';

export interface GstSetoffSummary {
  igst_to_igst: number;
  igst_to_cgst: number;
  igst_to_sgst: number;
  cgst_to_cgst: number;
  cgst_to_igst: number;
  sgst_to_sgst: number;
  sgst_to_igst: number;
}

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
  narrationPrefix?: string;
}

export interface RecordGstPaymentResult {
  voucherId: string;
  challan_details: {
    challan_number: string | null;
    payment_date: string;
    tax_head: GstTaxHead;
    payment_mode: string | null;
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
  rcm_output_2155: number;
  total_liability: number;
}

/** Liability accounts that receive Dr on `gst_payment` (cash discharge; excludes ITC set-off). */
export const GST_PAYMENT_LIABILITY_ACCOUNT_CODES: readonly string[] = [
  GSTR3B_OUTPUT_IGST,
  GSTR3B_OUTPUT_CGST,
  GSTR3B_OUTPUT_SGST,
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
 * Chronological cash GST payments from `gst_payment` vouchers (Dr to output / RCM liability).
 * Same-day payments are summed. ITC set-off uses `gst_setoff` and is excluded.
 * `uptoDate` is an inclusive hard cap at the SQL layer (`entry_date <= uptoDate`) — no rows after as-on.
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
      AND lel.voucher_type = 'gst_payment'
      AND a.account_code = ANY($5::text[])
      AND lel.entry_date > $3::date
      AND lel.entry_date <= $4::date
      AND lel.debit > 0
    GROUP BY lel.entry_date::date
    ORDER BY lel.entry_date::date ASC
    `,
    [businessId, branchId, afterDateExclusive, uptoDate, [...GST_PAYMENT_LIABILITY_ACCOUNT_CODES]]
  );
  return rows.map((r) => ({
    date: typeof r.d === 'string' ? r.d.slice(0, 10) : String(r.d).slice(0, 10),
    amount: round2(parseFloat(r.amt ?? '0')),
  }));
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
  ].filter((p) => p.amount >= 0.005);
}

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

  if (mode === 'balance') {
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

  const outputTotal = round2(outputIGST + outputCGST + outputSGST);
  const itcTotal = round2(itcIGST + itcCGST + itcSGST);
  if (outputTotal < 0.005 && itcTotal < 0.005) {
    return {
      posted: false,
      reason: 'Nothing to settle',
      gst_setoff_summary: {
        igst_to_igst: 0,
        igst_to_cgst: 0,
        igst_to_sgst: 0,
        cgst_to_cgst: 0,
        cgst_to_igst: 0,
        sgst_to_sgst: 0,
        sgst_to_igst: 0,
      },
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
  });

  const gst_setoff_summary: GstSetoffSummary = {
    igst_to_igst: util.igst_to_igst,
    igst_to_cgst: util.igst_to_cgst,
    igst_to_sgst: util.igst_to_sgst,
    cgst_to_cgst: util.cgst_to_cgst,
    cgst_to_igst: util.cgst_to_igst,
    sgst_to_sgst: util.sgst_to_sgst,
    sgst_to_igst: util.sgst_to_igst,
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

function taxHeadToOutputCode(head: GstTaxHead): string {
  switch (head) {
    case 'IGST':
      return GSTR3B_OUTPUT_IGST;
    case 'CGST':
      return GSTR3B_OUTPUT_CGST;
    case 'SGST':
      return GSTR3B_OUTPUT_SGST;
    case 'RCM':
      return GSTR3B_RCM_OUTPUT;
    default:
      throw new Error(`Unknown tax head: ${head}`);
  }
}

/**
 * Record cash/bank GST payment against output or RCM liability.
 * Dr Output (or RCM) / Cr Bank. Voucher type `gst_payment`.
 */
export async function recordGstPayment(params: RecordGstPaymentParams): Promise<RecordGstPaymentResult> {
  const {
    businessId,
    branchId,
    amount: rawAmount,
    taxHead,
    paymentDate,
    challanNumber,
    paymentMode,
    narrationPrefix,
  } = params;

  // RCM cannot be discharged with ITC — only cash/bank (this entry is always Cr Bank).
  if (taxHead === 'RCM') {
    const mode = (paymentMode || '').toLowerCase();
    if (mode === 'itc' || mode === 'itc_setoff' || mode === 'credit') {
      throw new Error('RCM cannot be paid using ITC — use bank/cash payment only.');
    }
  }

  const amount = round2(Number(rawAmount));
  if (amount < 0.005) {
    throw new Error('Payment amount must be positive');
  }

  const outCode = taxHeadToOutputCode(taxHead);
  const outAcc = await getAccountByCode(businessId, outCode);
  if (!outAcc) {
    throw new Error(`GST liability account ${outCode} not found`);
  }

  let bankAccId = params.bankAccountId;
  if (!bankAccId) {
    const bank = await getAccountByCode(businessId, BANK_DEFAULT_CODE);
    if (!bank) {
      throw new Error(`Bank account ${BANK_DEFAULT_CODE} not found — pass bankAccountId or create default bank`);
    }
    bankAccId = bank.id;
  }

  const pool = getPool();
  const client = await pool.connect();
  const voucherId = randomUUID();
  const ref = challanNumber ? `GST_PAY|${challanNumber}` : `GST_PAY|${voucherId.slice(0, 8)}`;
  const narrationBase = narrationPrefix ?? 'GST payment (challan)';

  try {
    await client.query('BEGIN');

    await createLedgerEntryLine({
      businessId,
      voucherId,
      voucherType: 'gst_payment',
      accountId: outAcc.id,
      entryDate: paymentDate,
      debit: amount,
      credit: 0,
      narration: `${narrationBase}: ${taxHead} liability`,
      referenceNumber: ref,
      branchId,
      poolClient: client,
    });
    await createLedgerEntryLine({
      businessId,
      voucherId,
      voucherType: 'gst_payment',
      accountId: bankAccId,
      entryDate: paymentDate,
      debit: 0,
      credit: amount,
      narration: `${narrationBase}: bank`,
      referenceNumber: ref,
      branchId,
      poolClient: client,
    });

    await client.query('COMMIT');
    return {
      voucherId,
      challan_details: {
        challan_number: challanNumber ?? null,
        payment_date: paymentDate,
        tax_head: taxHead,
        payment_mode: paymentMode ?? null,
      },
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
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
  const rcm_output_2155 = await bal(GSTR3B_RCM_OUTPUT);

  const total_liability = round2(output_igst + output_cgst + output_sgst + rcm_output_2155);

  return {
    as_on_date: asOnDate,
    output_igst,
    output_cgst,
    output_sgst,
    rcm_output_2155,
    total_liability,
  };
}
