import { getPool } from '@/lib/db';
import {
  aggregateGstr1OutputByHead,
  reconciliationByHead,
  type ReconciliationHeadRow,
} from '@/lib/gst/gstr1-reconciliation-basis';
import { GSTR1Generator } from './gstr1';
import {
  computeItcUtilizationDisplay,
  getItcFromInputLedgerNet,
  getLedgerNetCreditMinusDebit,
  GSTR3B_INPUT_CGST,
  GSTR3B_INPUT_IGST,
  GSTR3B_INPUT_SGST,
  GSTR3B_OUTPUT_CESS,
  GSTR3B_OUTPUT_CGST,
  GSTR3B_OUTPUT_IGST,
  GSTR3B_OUTPUT_SGST,
  GSTR3BLedgerBasis,
  hasInvoiceLedgerEntryDateMismatch,
  resolveRcmLedgerNets,
  round2,
} from './gstr3b-ledger';

export interface GSTR3BFilters {
  business_id: string;
  month: number;
  year: number;
  /** When set, ledger lines are scoped like `get_account_balance` (NULL branch + this branch). */
  branch_id?: string;
}

export interface GSTR3BReconciliation {
  status: 'matched' | 'mismatch';
  difference: number;
  /** (difference / ledger_total) * 100 when ledger_total ≠ 0; else 0 */
  difference_percent: number;
  ledger_total: number;
  gstr1_total: number;
}

export interface GSTR3BData {
  // Table 3.1 - Tax on outward and reverse charge inward supplies
  outward_taxable_supplies: TaxBreakdown;
  outward_zero_rated: TaxBreakdown;
  other_outward_supplies: TaxBreakdown;
  inward_reverse_charge: TaxBreakdown;

  // Table 4 - ITC (amounts from input GST ledger accounts only)
  itc_details: ITCDetails;

  /** Gross tax by head: output ledger (2150–2152) plus RCM by head when split accounts exist; pooled RCM is not allocated to heads here. */
  gross_output_tax: TaxBreakdown;

  /** Net tax payable by head after ITC utilization on 2150–2152 plus head-wise RCM when split; excludes pooled RCM (see summary.net_tax_payable). */
  tax_liability: TaxBreakdown;

  // Table 5 - Interest and Late Fee
  interest_late_fee: {
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };

  // Summary
  summary: {
    total_tax_liability: number;
    total_itc: number;
    net_tax_payable: number;
    /** Present when RCM is on 2155 only: included in net_tax_payable but not in tax_liability.* heads */
    rcm_pooled_component?: number;
  };

  /** Audit trail: ledger-only GST figures and utilization working. */
  ledger_basis: GSTR3BLedgerBasis;

  /**
   * Table 3.1(a) — outward taxable (non zero-rated): inter-state shows IGST only;
   * intra-state shows CGST + SGST only. Tax from ledger; taxable values from GSTR-1 domestic split.
   */
  outward_taxable_supplies_nature: {
    inter_state: TaxBreakdown;
    intra_state: TaxBreakdown;
  };

  /** Top-level mirrors for audit / API consumers (same as nested ledger fields). */
  outward_supplies: { igst: number; cgst: number; sgst: number };
  rcm: GSTR3BLedgerBasis['rcm'];
  /** Mirrors `resolveRcmLedgerNets`: split = 2156–2158; pooled = 2155 (or split accounts idle). */
  rcm_mode: 'split' | 'pooled';
  itc: { igst: number; cgst: number; sgst: number };
  utilization: GSTR3BLedgerBasis['utilization'];
  net_payable: GSTR3BLedgerBasis['net_payable'];

  reconciliation: GSTR3BReconciliation;
  /** Ledger vs GSTR-1 by tax head (2150–2152 + 2153 vs invoice/CDN-derived), incl. CESS. */
  reconciliation_by_head: {
    igst: ReconciliationHeadRow;
    cgst: ReconciliationHeadRow;
    sgst: ReconciliationHeadRow;
    cess: ReconciliationHeadRow;
  };
  warnings: string[];
}

export interface TaxBreakdown {
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface ITCDetails {
  imports: TaxBreakdown;
  inward_reverse_charge: TaxBreakdown;
  other_itc: TaxBreakdown;
  itc_reversed: TaxBreakdown;
  net_itc: TaxBreakdown;
}

const emptyTax = (): TaxBreakdown => ({
  taxable_value: 0,
  igst: 0,
  cgst: 0,
  sgst: 0,
  cess: 0,
});

type Gstr1Bundle = Awaited<ReturnType<InstanceType<typeof GSTR1Generator>['generate']>>;

/** First 2-digit state/UT code from POS string (e.g. `29-State` or `29`). */
function extractStateCode(placeOfSupply: string | undefined | null): string {
  if (!placeOfSupply) return '';
  const m = String(placeOfSupply).match(/^(\d{2})/);
  if (m) return m[1];
  const d = String(placeOfSupply).replace(/\D/g, '');
  return d.length >= 2 ? d.slice(0, 2) : '';
}

function isInterStateDomestic(
  placeOfSupply: string | undefined | null,
  igstAmount: number,
  selfState: string | null
): boolean {
  const pos = extractStateCode(placeOfSupply);
  if (pos === '96' || pos === '97') return false;
  if (selfState && pos.length === 2) return pos !== selfState;
  return igstAmount > 0;
}

/**
 * Split domestic taxable value (row 3.1a total = targetTotal) using GSTR-1 B2B/B2CL/B2CS lines.
 * Does not use tax %; optional POS vs registered GSTIN state, else IGST>0 heuristic.
 */
function domesticTaxableNatureTotals(
  gstr1Data: Gstr1Bundle,
  selfState: string | null,
  targetTotal: number
): { inter: number; intra: number } {
  let rawInter = 0;
  let rawIntra = 0;

  for (const row of gstr1Data.b2b) {
    const inter = isInterStateDomestic(row.place_of_supply, row.igst_amount, selfState);
    if (inter) rawInter += row.taxable_value;
    else rawIntra += row.taxable_value;
  }
  for (const row of gstr1Data.b2cl) {
    const inter = isInterStateDomestic(row.place_of_supply, row.igst_amount, selfState);
    if (inter) rawInter += row.taxable_value;
    else rawIntra += row.taxable_value;
  }
  for (const row of gstr1Data.b2cs) {
    const inter = isInterStateDomestic(row.place_of_supply, row.igst_amount, selfState);
    if (inter) rawInter += row.taxable_value;
    else rawIntra += row.taxable_value;
  }

  const raw = rawInter + rawIntra;
  if (targetTotal <= 0) {
    return { inter: 0, intra: 0 };
  }
  if (raw <= 0) {
    return { inter: 0, intra: round2(targetTotal) };
  }
  const inter = round2((rawInter / raw) * targetTotal);
  const intra = round2(targetTotal - inter);
  return { inter, intra };
}

export class GSTR3BGenerator {
  private gstr1Generator = new GSTR1Generator();

  async generate(filters: GSTR3BFilters): Promise<GSTR3BData> {
    const { business_id, month, year, branch_id } = filters;

    const startOfMonth = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];
    const branch = branch_id ?? null;

    const gstr1Data = await this.gstr1Generator.generate({
      business_id,
      month,
      year,
      branch_id,
    });

    const outputIGST = await getLedgerNetCreditMinusDebit(
      business_id,
      GSTR3B_OUTPUT_IGST,
      startOfMonth,
      endOfMonth,
      branch
    );
    const outputCGST = await getLedgerNetCreditMinusDebit(
      business_id,
      GSTR3B_OUTPUT_CGST,
      startOfMonth,
      endOfMonth,
      branch
    );
    const outputSGST = await getLedgerNetCreditMinusDebit(
      business_id,
      GSTR3B_OUTPUT_SGST,
      startOfMonth,
      endOfMonth,
      branch
    );
    const outputCess = await getLedgerNetCreditMinusDebit(
      business_id,
      GSTR3B_OUTPUT_CESS,
      startOfMonth,
      endOfMonth,
      branch
    );

    const rcmResolved = await resolveRcmLedgerNets(business_id, startOfMonth, endOfMonth, branch);

    const netIn1110 = await getLedgerNetCreditMinusDebit(
      business_id,
      GSTR3B_INPUT_CGST,
      startOfMonth,
      endOfMonth,
      branch
    );
    const netIn1111 = await getLedgerNetCreditMinusDebit(
      business_id,
      GSTR3B_INPUT_SGST,
      startOfMonth,
      endOfMonth,
      branch
    );
    const netIn1112 = await getLedgerNetCreditMinusDebit(
      business_id,
      GSTR3B_INPUT_IGST,
      startOfMonth,
      endOfMonth,
      branch
    );

    const itcCGST = getItcFromInputLedgerNet(netIn1110);
    const itcSGST = getItcFromInputLedgerNet(netIn1111);
    const itcIGST = getItcFromInputLedgerNet(netIn1112);

    const rcmIgstForLiability = rcmResolved.igst ?? 0;
    const rcmCgstForLiability = rcmResolved.cgst ?? 0;
    const rcmSgstForLiability = rcmResolved.sgst ?? 0;

    const igstLiabilityGross = round2(outputIGST + rcmIgstForLiability);
    const cgstLiabilityGross = round2(outputCGST + rcmCgstForLiability);
    const sgstLiabilityGross = round2(outputSGST + rcmSgstForLiability);

    const util = computeItcUtilizationDisplay({
      igstLiability: igstLiabilityGross,
      cgstLiability: cgstLiabilityGross,
      sgstLiability: sgstLiabilityGross,
      itcIgst: itcIGST,
      itcCgst: itcCGST,
      itcSgst: itcSGST,
    });

    const gstr1Out = aggregateGstr1OutputByHead(gstr1Data);
    const gstr1Tax = { igst: gstr1Out.igst, cgst: gstr1Out.cgst, sgst: gstr1Out.sgst };
    const reconciliation_by_head = reconciliationByHead({
      ledger: {
        igst: outputIGST,
        cgst: outputCGST,
        sgst: outputSGST,
        cess: outputCess,
      },
      gstr1: {
        igst: gstr1Out.igst,
        cgst: gstr1Out.cgst,
        sgst: gstr1Out.sgst,
        cess: gstr1Out.cess,
      },
    });

    /** Legacy: IGST+CGST+SGST only (excludes CESS). */
    const ledgerTotal = round2(outputIGST + outputCGST + outputSGST);
    const gstr1Total = round2(gstr1Tax.igst + gstr1Tax.cgst + gstr1Tax.sgst);
    const tolerance = 1;
    const diff = round2(ledgerTotal - gstr1Total);
    const differencePercent =
      ledgerTotal === 0 ? 0 : round2((diff / ledgerTotal) * 100);
    const reconciliation: GSTR3BReconciliation = {
      status: Math.abs(diff) <= tolerance ? 'matched' : 'mismatch',
      difference: diff,
      difference_percent: differencePercent,
      ledger_total: ledgerTotal,
      gstr1_total: gstr1Total,
    };

    const warnings: string[] = [];
    const dateMismatch = await hasInvoiceLedgerEntryDateMismatch(
      business_id,
      startOfMonth,
      endOfMonth,
      branch
    );
    if (dateMismatch) {
      warnings.push(
        'Invoice date and ledger entry date differ for one or more invoices in this period — GSTR-1 uses invoice_date; GSTR-3B output ledgers use entry_date.'
      );
    }
    if (
      reconciliation_by_head.igst.status === 'mismatch' ||
      reconciliation_by_head.cgst.status === 'mismatch' ||
      reconciliation_by_head.sgst.status === 'mismatch' ||
      reconciliation_by_head.cess.status === 'mismatch'
    ) {
      warnings.push(
        'GSTR-1 vs ledger mismatch on one or more tax heads (IGST/CGST/SGST/CESS) — see reconciliation_by_head.'
      );
    }
    if (outputCess < -0.005) {
      warnings.push('Negative output CESS (2153) detected for the period.');
    }
    if (rcmResolved.mode === 'pooled' && rcmResolved.total > 0.005) {
      warnings.push('RCM not split into tax heads (ledger 2155 only). Configure 2156/2157/2158 for head-wise RCM.');
    }
    if (reconciliation.status === 'mismatch') {
      warnings.push('GSTR-1 and ledger output tax (2150–2152) mismatch — reconcile returns vs books.');
    }
    if (Math.abs(differencePercent) > 2) {
      warnings.push('Significant mismatch between GSTR-1 and ledger output tax (>2% of ledger total).');
    }
    if (outputIGST < 0 || outputCGST < 0 || outputSGST < 0) {
      warnings.push('Negative output GST detected on one or more output accounts (2150–2152).');
    }
    if (rcmResolved.warning) {
      warnings.push(rcmResolved.warning);
    }
    if (netIn1110 > 0 || netIn1111 > 0 || netIn1112 > 0) {
      warnings.push(
        'Input GST ledger accounts (1110–1112) show net credits for the period — check reversals / credit notes.'
      );
    }
    if (outputIGST > 0 && (outputCGST > 0 || outputSGST > 0)) {
      warnings.push('Mixed supply in period: both inter-state (IGST) and intra-state (CGST/SGST) output tax on ledger.');
    }

    const itcClaimedTotal = round2(itcIGST + itcCGST + itcSGST);
    const rcmItcMismatch = rcmResolved.total > 0.005 && itcClaimedTotal === 0;
    if (rcmItcMismatch) {
      warnings.push('RCM paid but no ITC claimed (ledger 1110–1112 net ITC for the period is zero).');
    }

    const ledgerRcmBlock: GSTR3BLedgerBasis['rcm'] = {
      igst: rcmResolved.igst,
      cgst: rcmResolved.cgst,
      sgst: rcmResolved.sgst,
      total: rcmResolved.total,
      ...(rcmResolved.warning ? { warning: rcmResolved.warning } : {}),
    };

    const ledger_basis: GSTR3BLedgerBasis = {
      outward_supplies: {
        igst: round2(outputIGST),
        cgst: round2(outputCGST),
        sgst: round2(outputSGST),
      },
      rcm: ledgerRcmBlock,
      rcm_itc_analysis: {
        rcm_output_total: round2(rcmResolved.total),
        itc_claimed_total: itcClaimedTotal,
        possible_rcm_itc_mismatch: rcmItcMismatch,
      },
      itc: {
        igst: round2(itcIGST),
        cgst: round2(itcCGST),
        sgst: round2(itcSGST),
      },
      utilization: {
        igst_to_igst: util.igst_to_igst,
        igst_to_cgst: util.igst_to_cgst,
        igst_to_sgst: util.igst_to_sgst,
        cgst_to_cgst: util.cgst_to_cgst,
        cgst_to_igst: util.cgst_to_igst,
        sgst_to_sgst: util.sgst_to_sgst,
        sgst_to_igst: util.sgst_to_igst,
      },
      net_payable: util.net_payable,
    };

    const pool = getPool();
    const bizRes = await pool.query<{ gstin: string | null }>(
      `SELECT gstin FROM businesses WHERE id = $1::uuid LIMIT 1`,
      [business_id]
    );
    const selfState =
      bizRes.rows[0]?.gstin && bizRes.rows[0].gstin.length >= 2
        ? bizRes.rows[0].gstin.slice(0, 2)
        : null;

    const wA =
      gstr1Data.b2b.reduce((s, r) => s + r.taxable_value, 0) +
      gstr1Data.b2cl.reduce((s, r) => s + r.taxable_value, 0) +
      gstr1Data.b2cs.reduce((s, r) => s + r.taxable_value, 0);
    const wB =
      gstr1Data.exports.reduce((s, e) => s + e.taxable_value, 0) +
      gstr1Data.sez.reduce((s, e) => s + e.taxable_value, 0);
    const wOut = wA + wB;
    let shareA = 1;
    let shareB = 0;
    if (wOut > 0) {
      shareA = wA / wOut;
      shareB = wB / wOut;
    }

    const { inter: tvInterA, intra: tvIntraA } = domesticTaxableNatureTotals(gstr1Data, selfState, wA);

    const cessDomestic = round2(outputCess * shareA);
    const cessZeroRated = round2(outputCess - cessDomestic);
    let cessInterNat = 0;
    let cessIntraNat = 0;
    if (wA > 0.005) {
      cessInterNat = round2(cessDomestic * (tvInterA / wA));
      cessIntraNat = round2(cessDomestic - cessInterNat);
    } else {
      cessIntraNat = cessDomestic;
    }

    const outward_taxable_supplies_nature = {
      inter_state: {
        taxable_value: tvInterA,
        igst: round2(outputIGST * shareA),
        cgst: 0,
        sgst: 0,
        cess: cessInterNat,
      },
      intra_state: {
        taxable_value: tvIntraA,
        igst: 0,
        cgst: round2(outputCGST * shareA),
        sgst: round2(outputSGST * shareA),
        cess: cessIntraNat,
      },
    };

    const outward_taxable_supplies: TaxBreakdown = {
      taxable_value: wA,
      igst: round2(outputIGST * shareA),
      cgst: round2(outputCGST * shareA),
      sgst: round2(outputSGST * shareA),
      cess: cessDomestic,
    };

    const outward_zero_rated: TaxBreakdown = {
      taxable_value: wB,
      igst: round2(outputIGST - outward_taxable_supplies.igst),
      cgst: round2(outputCGST - outward_taxable_supplies.cgst),
      sgst: round2(outputSGST - outward_taxable_supplies.sgst),
      cess: cessZeroRated,
    };

    const otherTaxable = gstr1Data.nil.reduce(
      (s, n) => s + n.nil_supply + n.exempt_supply + n.non_gst_supply,
      0
    );
    const other_outward_supplies: TaxBreakdown = {
      taxable_value: otherTaxable,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    };

    const inward_reverse_charge: TaxBreakdown =
      rcmResolved.mode === 'split'
        ? {
            taxable_value: 0,
            igst: rcmResolved.igst ?? 0,
            cgst: rcmResolved.cgst ?? 0,
            sgst: rcmResolved.sgst ?? 0,
            cess: 0,
          }
        : {
            taxable_value: 0,
            igst: 0,
            cgst: 0,
            sgst: 0,
            cess: 0,
          };

    const empty = emptyTax();
    const other_itc: TaxBreakdown = {
      taxable_value: 0,
      igst: itcIGST,
      cgst: itcCGST,
      sgst: itcSGST,
      cess: 0,
    };

    const net_itc: TaxBreakdown = {
      taxable_value: other_itc.taxable_value,
      igst: other_itc.igst,
      cgst: other_itc.cgst,
      sgst: other_itc.sgst,
      cess: 0,
    };

    const gross_output_tax: TaxBreakdown = {
      taxable_value: wA + wB + otherTaxable,
      igst: round2(outputIGST + rcmIgstForLiability),
      cgst: round2(outputCGST + rcmCgstForLiability),
      sgst: round2(outputSGST + rcmSgstForLiability),
      cess: round2(outputCess),
    };

    const netPayableFromUtil =
      util.net_payable.igst + util.net_payable.cgst + util.net_payable.sgst;
    const rcmPooledComponent =
      rcmResolved.mode === 'pooled' && rcmResolved.total > 0.005 ? round2(rcmResolved.total) : undefined;
    const net_tax_payable =
      rcmResolved.mode === 'pooled'
        ? round2(netPayableFromUtil + rcmResolved.total)
        : round2(netPayableFromUtil);

    const tax_liability: TaxBreakdown = {
      taxable_value: gross_output_tax.taxable_value,
      igst: util.net_payable.igst,
      cgst: util.net_payable.cgst,
      sgst: util.net_payable.sgst,
      cess: 0,
    };

    const grossHeadSum = gross_output_tax.igst + gross_output_tax.cgst + gross_output_tax.sgst;
    const total_tax_liability = round2(
      grossHeadSum + (rcmResolved.mode === 'pooled' ? rcmResolved.total : 0)
    );
    const total_itc = net_itc.igst + net_itc.cgst + net_itc.sgst + net_itc.cess;

    return {
      outward_taxable_supplies,
      outward_zero_rated,
      other_outward_supplies,
      inward_reverse_charge,
      itc_details: {
        imports: { ...empty },
        inward_reverse_charge: { ...empty },
        other_itc,
        itc_reversed: { ...empty },
        net_itc,
      },
      gross_output_tax,
      tax_liability,
      interest_late_fee: {
        igst: 0,
        cgst: 0,
        sgst: 0,
        cess: 0,
      },
      summary: {
        total_tax_liability,
        total_itc: round2(total_itc),
        net_tax_payable,
        ...(rcmPooledComponent !== undefined ? { rcm_pooled_component: rcmPooledComponent } : {}),
      },
      ledger_basis,
      outward_taxable_supplies_nature,
      outward_supplies: ledger_basis.outward_supplies,
      rcm: ledger_basis.rcm,
      rcm_mode: rcmResolved.mode,
      itc: ledger_basis.itc,
      utilization: ledger_basis.utilization,
      net_payable: ledger_basis.net_payable,
      reconciliation,
      reconciliation_by_head,
      warnings,
    };
  }
}
