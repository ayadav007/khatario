import { getPool } from '@/lib/db';
import { getAccountByCode } from '@/lib/ledger-utils';

/** Output GST (liability) — net = credits − debits on the account for the period */
export const GSTR3B_OUTPUT_CGST = '2150';
export const GSTR3B_OUTPUT_SGST = '2151';
export const GSTR3B_OUTPUT_IGST = '2152';
/** Output CESS payable (liability) — same net interpretation as 2150–2152 */
export const GSTR3B_OUTPUT_CESS = '2153';
/** Legacy pooled RCM output (use when 2156–2158 are not set up) */
export const GSTR3B_RCM_OUTPUT = '2155';
/** RCM output by tax head (preferred) */
export const GSTR3B_RCM_CGST = '2156';
export const GSTR3B_RCM_SGST = '2157';
export const GSTR3B_RCM_IGST = '2158';

/** Input GST (ITC) — debit-nature; positive ITC from net (credit − debit) via getItcFromInputLedgerNet */
export const GSTR3B_INPUT_CGST = '1110';
export const GSTR3B_INPUT_SGST = '1111';
export const GSTR3B_INPUT_IGST = '1112';

export interface GSTR3BLedgerBasis {
  outward_supplies: { igst: number; cgst: number; sgst: number };
  rcm: {
    igst: number | null;
    cgst: number | null;
    sgst: number | null;
    total: number;
    warning?: string;
  };
  /** Visibility: pooled RCM output vs ITC claimed (same-period ledger) for audit review */
  rcm_itc_analysis: {
    rcm_output_total: number;
    itc_claimed_total: number;
    possible_rcm_itc_mismatch: boolean;
  };
  itc: { igst: number; cgst: number; sgst: number };
  utilization: {
    igst_to_igst: number;
    igst_to_cgst: number;
    igst_to_sgst: number;
    cgst_to_cgst: number;
    cgst_to_igst: number;
    sgst_to_sgst: number;
    sgst_to_igst: number;
  };
  net_payable: { igst: number; cgst: number; sgst: number };
}

export interface ResolvedRcmLedger {
  mode: 'split' | 'pooled';
  igst: number | null;
  cgst: number | null;
  sgst: number | null;
  total: number;
  /** Period net on 2155 when mode is split — non-zero may indicate duplicate RCM posting */
  pooled2155PeriodNet?: number;
  warning?: string;
}

/**
 * RCM from ledger only: prefer 2156/2157/2158 when all exist; otherwise 2155 (pooled).
 * No ratio-based splitting.
 */
export async function resolveRcmLedgerNets(
  businessId: string,
  fromDate: string,
  toDate: string,
  branchId?: string | null
): Promise<ResolvedRcmLedger> {
  const [a2156, a2157, a2158] = await Promise.all([
    getAccountByCode(businessId, GSTR3B_RCM_CGST),
    getAccountByCode(businessId, GSTR3B_RCM_SGST),
    getAccountByCode(businessId, GSTR3B_RCM_IGST),
  ]);

  if (a2156 && a2157 && a2158) {
    const [rcmCGST, rcmSGST, rcmIGST, rcm2155] = await Promise.all([
      getLedgerNetCreditMinusDebit(businessId, GSTR3B_RCM_CGST, fromDate, toDate, branchId),
      getLedgerNetCreditMinusDebit(businessId, GSTR3B_RCM_SGST, fromDate, toDate, branchId),
      getLedgerNetCreditMinusDebit(businessId, GSTR3B_RCM_IGST, fromDate, toDate, branchId),
      getLedgerNetCreditMinusDebit(businessId, GSTR3B_RCM_OUTPUT, fromDate, toDate, branchId),
    ]);
    const igst = round2(rcmIGST);
    const cgst = round2(rcmCGST);
    const sgst = round2(rcmSGST);
    const splitTotal = round2(igst + cgst + sgst);

    if (Math.abs(splitTotal) < 0.005 && Math.abs(rcm2155) > 0.005) {
      const total = round2(rcm2155);
      return {
        mode: 'pooled',
        igst: null,
        cgst: null,
        sgst: null,
        total,
        warning:
          'Accounts 2156–2158 exist but have no period movement; RCM taken from 2155. Post to split RCM accounts when migrating.',
      };
    }

    let warning: string | undefined;
    if (Math.abs(splitTotal) > 0.005 && Math.abs(rcm2155) > 0.005) {
      warning =
        'RCM split accounts (2156–2158) are in use but account 2155 also shows a non-zero balance for the period — review for duplicate RCM posting.';
    }
    return {
      mode: 'split',
      igst,
      cgst,
      sgst,
      total: splitTotal,
      pooled2155PeriodNet: round2(rcm2155),
      warning,
    };
  }

  const rcmTotal = await getLedgerNetCreditMinusDebit(
    businessId,
    GSTR3B_RCM_OUTPUT,
    fromDate,
    toDate,
    branchId
  );
  const total = round2(rcmTotal);
  return {
    mode: 'pooled',
    igst: null,
    cgst: null,
    sgst: null,
    total,
    warning:
      total > 0.005
        ? 'RCM tax head split not available. Configure separate ledger accounts 2156 (RCM CGST), 2157 (RCM SGST), and 2158 (RCM IGST) for head-wise accuracy.'
        : undefined,
  };
}

/**
 * Generic ledger net for liability-style interpretation: SUM(credit) − SUM(debit).
 * Uses `ledger_entry_lines` (debit/credit columns; no invoice-derived tax).
 */
export async function getLedgerNetCreditMinusDebit(
  businessId: string,
  accountCode: string,
  fromDate: string,
  toDate: string,
  branchId?: string | null
): Promise<number> {
  const acc = await getAccountByCode(businessId, accountCode);
  if (!acc) return 0;

  const pool = getPool();
  const params: string[] = [businessId, acc.id, fromDate, toDate];
  let branchClause = '';
  if (branchId) {
    branchClause = ' AND (branch_id IS NULL OR branch_id = $5::uuid)';
    params.push(branchId);
  }

  const { rows } = await pool.query<{ credit: string; debit: string }>(
    `
    SELECT
      COALESCE(SUM(credit), 0)::text AS credit,
      COALESCE(SUM(debit), 0)::text AS debit
    FROM ledger_entry_lines
    WHERE business_id = $1::uuid
      AND account_id = $2::uuid
      AND entry_date >= $3::date
      AND entry_date <= $4::date
      ${branchClause}
    `,
    params
  );

  const credit = parseFloat(rows[0]?.credit ?? '0');
  const debit = parseFloat(rows[0]?.debit ?? '0');
  return round2(credit - debit);
}

/**
 * True when any `invoice` voucher line in the period uses `entry_date` ≠ `invoices.invoice_date`.
 * GSTR-1 is invoice-date based; GSTR-3B output ledgers use entry_date — divergence causes reconciliation noise.
 */
export async function hasInvoiceLedgerEntryDateMismatch(
  businessId: string,
  fromDate: string,
  toDate: string,
  branchId?: string | null
): Promise<boolean> {
  const pool = getPool();
  const params: string[] = [businessId, fromDate, toDate];
  let branchClause = '';
  if (branchId) {
    branchClause = ' AND (lel.branch_id IS NULL OR lel.branch_id = $4::uuid)';
    params.push(branchId);
  }
  const { rows } = await pool.query<{ ex: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM ledger_entry_lines lel
      INNER JOIN invoices i ON i.id = lel.voucher_id AND lel.voucher_type = 'invoice' AND i.deleted_at IS NULL
      WHERE lel.business_id = $1::uuid
        AND lel.entry_date >= $2::date
        AND lel.entry_date <= $3::date
        ${branchClause}
        AND i.invoice_date IS DISTINCT FROM lel.entry_date
      LIMIT 1
    ) AS ex
    `,
    params
  );
  return rows[0]?.ex === true;
}

/** Input GST accounts: positive ITC when debits exceed credits on a net of (credit − debit). */
export function getItcFromInputLedgerNet(netCreditMinusDebit: number): number {
  return Math.max(0, round2(-netCreditMinusDebit));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Statutory ITC utilization order (display / working): IGST ITC → IGST, CGST, SGST; then CGST ITC →
 * CGST, IGST; then SGST ITC → SGST, IGST. No CGST ↔ SGST cross-utilization.
 */
export function computeItcUtilizationDisplay(params: {
  igstLiability: number;
  cgstLiability: number;
  sgstLiability: number;
  itcIgst: number;
  itcCgst: number;
  itcSgst: number;
}): GSTR3BLedgerBasis['utilization'] & { net_payable: GSTR3BLedgerBasis['net_payable'] } {
  let igstLiability = round2(params.igstLiability);
  let cgstLiability = round2(params.cgstLiability);
  let sgstLiability = round2(params.sgstLiability);

  let igstITC = round2(params.itcIgst);
  let cgstITC = round2(params.itcCgst);
  let sgstITC = round2(params.itcSgst);

  const igst_to_igst = round2(Math.min(igstITC, igstLiability));
  igstITC = round2(igstITC - igst_to_igst);
  igstLiability = round2(igstLiability - igst_to_igst);

  const igst_to_cgst = round2(Math.min(igstITC, cgstLiability));
  igstITC = round2(igstITC - igst_to_cgst);
  cgstLiability = round2(cgstLiability - igst_to_cgst);

  const igst_to_sgst = round2(Math.min(igstITC, sgstLiability));
  igstITC = round2(igstITC - igst_to_sgst);
  sgstLiability = round2(sgstLiability - igst_to_sgst);

  const cgst_to_cgst = round2(Math.min(cgstITC, cgstLiability));
  cgstITC = round2(cgstITC - cgst_to_cgst);
  cgstLiability = round2(cgstLiability - cgst_to_cgst);

  const cgst_to_igst = round2(Math.min(cgstITC, igstLiability));
  cgstITC = round2(cgstITC - cgst_to_igst);
  igstLiability = round2(igstLiability - cgst_to_igst);

  const sgst_to_sgst = round2(Math.min(sgstITC, sgstLiability));
  sgstITC = round2(sgstITC - sgst_to_sgst);
  sgstLiability = round2(sgstLiability - sgst_to_sgst);

  const sgst_to_igst = round2(Math.min(sgstITC, igstLiability));
  sgstITC = round2(sgstITC - sgst_to_igst);
  igstLiability = round2(igstLiability - sgst_to_igst);

  const net_payable = {
    igst: Math.max(0, round2(igstLiability)),
    cgst: Math.max(0, round2(cgstLiability)),
    sgst: Math.max(0, round2(sgstLiability)),
  };

  return {
    igst_to_igst,
    igst_to_cgst,
    igst_to_sgst,
    cgst_to_cgst,
    cgst_to_igst,
    sgst_to_sgst,
    sgst_to_igst,
    net_payable,
  };
}
