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
export const GSTR3B_INPUT_CESS = '1113';

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
  itc: { igst: number; cgst: number; sgst: number; cess?: number };
  utilization: {
    igst_to_igst: number;
    igst_to_cgst: number;
    igst_to_sgst: number;
    cgst_to_cgst: number;
    cgst_to_igst: number;
    sgst_to_sgst: number;
    sgst_to_igst: number;
    cess_to_cess: number;
  };
  /** Cash payable on output tax after ITC; RCM is paid in cash on top of this (see GSTR-3B summary). */
  net_payable: { igst: number; cgst: number; sgst: number; cess: number };
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
 * Settlement and carry-forward vouchers move GST balances without being a supply or an ITC
 * event of the period; counting them would understate 3.1/4A after a set-off or payment.
 */
export const GSTR3B_NON_SUPPLY_VOUCHER_TYPES = [
  'gst_setoff',
  'gst_payment',
  'gst_cash_deposit',
  'gst_cash_utilization',
  'opening_balance',
  'year_close',
] as const;

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
  const params: (string | readonly string[])[] = [
    businessId,
    acc.id,
    fromDate,
    toDate,
    GSTR3B_NON_SUPPLY_VOUCHER_TYPES,
  ];
  let branchClause = '';
  if (branchId) {
    branchClause = ' AND (branch_id IS NULL OR branch_id = $6::uuid)';
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
      AND voucher_type <> ALL($5::text[])
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
 * GSTR-3B Table 6.1 cash working: ITC is set off against output tax only; RCM (split heads or
 * pooled 2155) is added afterwards as cash (s.49(4) with s.2(82) — RCM is not "output tax").
 */
export function computeGstr3bCashPayable(params: {
  output: { igst: number; cgst: number; sgst: number; cess: number };
  itc: { igst: number; cgst: number; sgst: number; cess: number };
  rcm: Pick<ResolvedRcmLedger, 'mode' | 'igst' | 'cgst' | 'sgst' | 'total'>;
}) {
  const util = computeItcUtilizationDisplay({
    igstLiability: params.output.igst,
    cgstLiability: params.output.cgst,
    sgstLiability: params.output.sgst,
    cessLiability: params.output.cess,
    itcIgst: params.itc.igst,
    itcCgst: params.itc.cgst,
    itcSgst: params.itc.sgst,
    itcCess: params.itc.cess,
  });
  const split = params.rcm.mode === 'split';
  const rcmHead = (v: number | null) => (split ? Math.max(0, round2(v ?? 0)) : 0);
  const payable_by_head = {
    igst: round2(util.net_payable.igst + rcmHead(params.rcm.igst)),
    cgst: round2(util.net_payable.cgst + rcmHead(params.rcm.cgst)),
    sgst: round2(util.net_payable.sgst + rcmHead(params.rcm.sgst)),
    cess: util.net_payable.cess,
  };
  const rcm_pooled_cash = split ? 0 : Math.max(0, round2(params.rcm.total));
  const net_tax_payable = round2(
    payable_by_head.igst + payable_by_head.cgst + payable_by_head.sgst + payable_by_head.cess + rcm_pooled_cash
  );
  return { util, payable_by_head, rcm_pooled_cash, net_tax_payable };
}

/**
 * ITC utilization per s.49(5) and Rule 88A. Pass OUTPUT tax only: RCM liability (s.49(4)) is
 * discharged in cash and must not be offered to this function.
 *
 * - IGST ITC goes to IGST first; the balance may go to CGST and SGST "in any order and in any
 *   proportion" (Rule 88A). It is allocated to the CGST/SGST liability that own-head ITC cannot
 *   cover, so eligible CGST/SGST ITC is not stranded while cash is paid on the other head.
 * - IGST ITC is exhausted (as far as liability allows) before CGST/SGST ITC is used.
 * - CGST ITC → CGST, then IGST; SGST ITC → SGST, then IGST. No CGST ↔ SGST cross-utilization.
 * - Cess ITC is usable only against cess (Compensation Cess Act s.11(2) proviso).
 */
export function computeItcUtilizationDisplay(params: {
  igstLiability: number;
  cgstLiability: number;
  sgstLiability: number;
  itcIgst: number;
  itcCgst: number;
  itcSgst: number;
  cessLiability?: number;
  itcCess?: number;
}): GSTR3BLedgerBasis['utilization'] & { net_payable: GSTR3BLedgerBasis['net_payable'] } {
  const pos = (n: number) => Math.max(0, round2(n));
  let igstLiability = pos(params.igstLiability);
  let cgstLiability = pos(params.cgstLiability);
  let sgstLiability = pos(params.sgstLiability);

  let igstITC = pos(params.itcIgst);
  let cgstITC = pos(params.itcCgst);
  let sgstITC = pos(params.itcSgst);

  const igst_to_igst = round2(Math.min(igstITC, igstLiability));
  igstITC = round2(igstITC - igst_to_igst);
  igstLiability = round2(igstLiability - igst_to_igst);

  const cgstGap = pos(cgstLiability - cgstITC);
  const sgstGap = pos(sgstLiability - sgstITC);
  let igst_to_cgst = round2(Math.min(igstITC, cgstGap));
  let igst_to_sgst = round2(Math.min(igstITC - igst_to_cgst, sgstGap));
  igstITC = round2(igstITC - igst_to_cgst - igst_to_sgst);
  // Remaining IGST ITC must still be used before CGST/SGST ITC (Rule 88A proviso).
  const extraC = round2(Math.min(igstITC, cgstLiability - igst_to_cgst));
  igst_to_cgst = round2(igst_to_cgst + extraC);
  igstITC = round2(igstITC - extraC);
  const extraS = round2(Math.min(igstITC, sgstLiability - igst_to_sgst));
  igst_to_sgst = round2(igst_to_sgst + extraS);
  igstITC = round2(igstITC - extraS);
  cgstLiability = round2(cgstLiability - igst_to_cgst);
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

  const cessLiability = pos(params.cessLiability ?? 0);
  const cess_to_cess = round2(Math.min(pos(params.itcCess ?? 0), cessLiability));

  const net_payable = {
    igst: pos(igstLiability),
    cgst: pos(cgstLiability),
    sgst: pos(sgstLiability),
    cess: pos(cessLiability - cess_to_cess),
  };

  return {
    igst_to_igst,
    igst_to_cgst,
    igst_to_sgst,
    cgst_to_cgst,
    cgst_to_igst,
    sgst_to_sgst,
    sgst_to_igst,
    cess_to_cess,
    net_payable,
  };
}
