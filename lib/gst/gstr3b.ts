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
  GSTR3B_INPUT_CESS,
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
  /** 3.1(c) nil-rated and exempted */
  other_outward_supplies: TaxBreakdown;
  /** 3.1(d) from reverse-charge bills of the period (incl. import of services) */
  inward_reverse_charge: TaxBreakdown;
  /** 3.1(e) non-GST outward supplies */
  non_gst_outward_supplies: TaxBreakdown;

  /** Table 3.2 — inter-state supplies to unregistered persons, by place of supply */
  inter_state_supplies_unregistered: Array<{ place_of_supply: string; taxable_value: number; igst: number }>;

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
  /** 4A(1) import of goods */
  imports: TaxBreakdown;
  /** 4A(2) import of services */
  import_services: TaxBreakdown;
  /** 4A(3) inward supplies liable to reverse charge */
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

function isExportPlaceOfSupply(placeOfSupply: string | undefined | null): boolean {
  const pos = extractStateCode(placeOfSupply);
  return pos === '96' || pos === '97';
}

/** Credit notes reduce outward supplies; debit notes add to them. */
function noteSign(note: { note_type: 'C' | 'D' }): number {
  return note.note_type === 'C' ? -1 : 1;
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
    const itcCess = getItcFromInputLedgerNet(
      await getLedgerNetCreditMinusDebit(business_id, GSTR3B_INPUT_CESS, startOfMonth, endOfMonth, branch)
    );

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

    // Table 3.1(a)/(b): tax heads come from the documents themselves, never pro-rated.
    const interA = emptyTax();
    const intraA = emptyTax();
    const zeroB = emptyTax();
    const interUnreg = new Map<string, { taxable_value: number; igst: number }>();
    const addTo = (t: TaxBreakdown, sign: number, v: { taxable: number; igst: number; cgst: number; sgst: number; cess: number }) => {
      t.taxable_value += sign * v.taxable;
      t.igst += sign * v.igst;
      t.cgst += sign * v.cgst;
      t.sgst += sign * v.sgst;
      t.cess += sign * v.cess;
    };
    const addDomestic = (
      pos: string,
      v: { taxable: number; igst: number; cgst: number; sgst: number; cess: number },
      sign = 1,
      unregistered = false
    ) => {
      const inter = isInterStateDomestic(pos, v.igst, selfState);
      addTo(inter ? interA : intraA, sign, v);
      if (inter && unregistered) {
        const code = extractStateCode(pos);
        const row = interUnreg.get(code) ?? { taxable_value: 0, igst: 0 };
        row.taxable_value += sign * v.taxable;
        row.igst += sign * v.igst;
        interUnreg.set(code, row);
      }
    };

    for (const r of gstr1Data.b2b) {
      addDomestic(r.place_of_supply, { taxable: r.taxable_value, igst: r.igst_amount, cgst: r.cgst_amount, sgst: r.sgst_amount, cess: r.cess_amount });
    }
    for (const r of gstr1Data.b2cl) {
      addDomestic(r.place_of_supply, { taxable: r.taxable_value, igst: r.igst_amount, cgst: 0, sgst: 0, cess: r.cess_amount }, 1, true);
    }
    for (const r of gstr1Data.b2cs) {
      addDomestic(r.place_of_supply, { taxable: r.taxable_value, igst: r.igst_amount, cgst: r.cgst_amount, sgst: r.sgst_amount, cess: r.cess_amount }, 1, true);
    }
    for (const r of gstr1Data.exports) {
      addTo(zeroB, 1, { taxable: r.taxable_value, igst: r.igst_amount, cgst: 0, sgst: 0, cess: 0 });
    }
    for (const r of gstr1Data.sez) {
      addTo(zeroB, 1, { taxable: r.taxable_value, igst: r.igst_amount, cgst: 0, sgst: 0, cess: r.cess_amount });
    }
    for (const n of gstr1Data.cdn) {
      const v = { taxable: n.taxable_value, igst: n.igst_amount, cgst: n.cgst_amount, sgst: n.sgst_amount, cess: n.cess_amount };
      const isZeroRatedNote =
        isExportPlaceOfSupply(n.place_of_supply) || n.cdnur_typ === 'EXPWP' || n.cdnur_typ === 'EXPWOP' ||
        n.note_supply_type.startsWith('SEZ');
      if (isZeroRatedNote) addTo(zeroB, noteSign(n), v);
      else addDomestic(n.place_of_supply, v, noteSign(n), !n.gstin_uin_recipient);
    }
    // Tax on service advances is payable in 3.1(a) on receipt (GSTR-1 11A) and reduced when adjusted (11B).
    for (const a of gstr1Data.at ?? []) {
      addDomestic(a.place_of_supply, { taxable: a.taxable_value, igst: a.igst, cgst: a.cgst, sgst: a.sgst, cess: a.cess });
    }
    for (const a of gstr1Data.atadj ?? []) {
      addDomestic(a.place_of_supply, { taxable: a.taxable_value, igst: a.igst, cgst: a.cgst, sgst: a.sgst, cess: a.cess }, -1);
    }

    const roundTax = (t: TaxBreakdown): TaxBreakdown => ({
      taxable_value: round2(t.taxable_value),
      igst: round2(t.igst),
      cgst: round2(t.cgst),
      sgst: round2(t.sgst),
      cess: round2(t.cess),
    });
    const outward_taxable_supplies_nature = { inter_state: roundTax(interA), intra_state: roundTax(intraA) };
    const outward_taxable_supplies = roundTax({
      taxable_value: interA.taxable_value + intraA.taxable_value,
      igst: interA.igst + intraA.igst,
      cgst: interA.cgst + intraA.cgst,
      sgst: interA.sgst + intraA.sgst,
      cess: interA.cess + intraA.cess,
    });
    const outward_zero_rated = roundTax(zeroB);
    const wA = outward_taxable_supplies.taxable_value;
    const wB = outward_zero_rated.taxable_value;

    const nilExempt = gstr1Data.nil.reduce((s, n) => s + n.nil_supply + n.exempt_supply, 0);
    const nonGst = gstr1Data.nil.reduce((s, n) => s + n.non_gst_supply, 0);
    const other_outward_supplies: TaxBreakdown = { ...emptyTax(), taxable_value: round2(nilExempt) };
    const non_gst_outward_supplies: TaxBreakdown = { ...emptyTax(), taxable_value: round2(nonGst) };
    const otherTaxable = round2(nilExempt + nonGst);

    const inter_state_supplies_unregistered = [...interUnreg.entries()]
      .filter(([, v]) => Math.abs(v.taxable_value) > 0.005)
      .map(([place_of_supply, v]) => ({
        place_of_supply,
        taxable_value: round2(v.taxable_value),
        igst: round2(v.igst),
      }))
      .sort((a, b) => a.place_of_supply.localeCompare(b.place_of_supply));

    // Table 3.1(d) and 4A(1)-(3): inward documents for the period.
    const inward = await pool.query(
      `SELECT
         CASE WHEN p.is_reverse_charge AND p.supplier_state_code = '96' THEN 'import_service'
              WHEN p.is_reverse_charge THEN 'rcm'
              WHEN p.document_type = 'bill_of_entry' THEN 'import_goods'
              ELSE 'regular' END AS bucket,
         (p.itc_eligible IS DISTINCT FROM false) AS eligible,
         COALESCE(SUM(p.subtotal), 0)   AS taxable,
         COALESCE(SUM(p.igst_total), 0) AS igst,
         COALESCE(SUM(p.cgst_total), 0) AS cgst,
         COALESCE(SUM(p.sgst_total), 0) AS sgst
       FROM purchases p
      WHERE p.business_id = $1::uuid
        AND p.deleted_at IS NULL
        AND COALESCE(p.status, '') NOT IN ('cancelled', 'draft')
        AND p.bill_date >= $2::date AND p.bill_date <= $3::date
        AND ($4::uuid IS NULL OR p.branch_id = $4::uuid)
      GROUP BY 1, 2
      UNION ALL
      SELECT 'rcm', COALESCE(e.itc_eligible, true),
             COALESCE(SUM(e.amount), 0), COALESCE(SUM(e.igst_amount), 0),
             COALESCE(SUM(e.cgst_amount), 0), COALESCE(SUM(e.sgst_amount), 0)
        FROM expenses e
       WHERE e.business_id = $1::uuid
         AND COALESCE(e.is_reverse_charge, false)
         AND e.expense_date >= $2::date AND e.expense_date <= $3::date
         AND ($4::uuid IS NULL OR e.branch_id = $4::uuid)
       GROUP BY 2
      UNION ALL
      SELECT 'regular', false,
             COALESCE(SUM(e.amount - COALESCE(e.igst_amount, 0) - COALESCE(e.cgst_amount, 0) - COALESCE(e.sgst_amount, 0)), 0),
             COALESCE(SUM(e.igst_amount), 0), COALESCE(SUM(e.cgst_amount), 0), COALESCE(SUM(e.sgst_amount), 0)
        FROM expenses e
       WHERE e.business_id = $1::uuid
         AND NOT COALESCE(e.is_reverse_charge, false)
         AND e.itc_eligible = false
         AND (COALESCE(e.igst_amount, 0) + COALESCE(e.cgst_amount, 0) + COALESCE(e.sgst_amount, 0)) > 0
         AND e.expense_date >= $2::date AND e.expense_date <= $3::date
         AND ($4::uuid IS NULL OR e.branch_id = $4::uuid)`,
      [business_id, startOfMonth, endOfMonth, branch]
    );
    const bucket = (name: string, eligible?: boolean): TaxBreakdown => {
      const t = emptyTax();
      for (const r of inward.rows) {
        if (r.bucket !== name || (eligible !== undefined && r.eligible !== eligible)) continue;
        addTo(t, 1, { taxable: Number(r.taxable), igst: Number(r.igst), cgst: Number(r.cgst), sgst: Number(r.sgst), cess: 0 });
      }
      return roundTax(t);
    };
    const rcmAll = bucket('rcm');
    const importServiceAll = bucket('import_service');
    const inward_reverse_charge = roundTax({
      taxable_value: rcmAll.taxable_value + importServiceAll.taxable_value,
      igst: rcmAll.igst + importServiceAll.igst,
      cgst: rcmAll.cgst + importServiceAll.cgst,
      sgst: rcmAll.sgst + importServiceAll.sgst,
      cess: 0,
    });

    const itcImports = bucket('import_goods', true);
    const itcImportServices = bucket('import_service', true);
    const itcRcm = bucket('rcm', true);
    // s.17(5) blocked credit: shown in 4A and reversed in 4B(1) (Circular 170/02/2022).
    const blocked = ['regular', 'rcm', 'import_goods', 'import_service']
      .map((b) => bucket(b, false))
      .reduce(
        (acc, t) => roundTax({
          taxable_value: acc.taxable_value + t.taxable_value,
          igst: acc.igst + t.igst,
          cgst: acc.cgst + t.cgst,
          sgst: acc.sgst + t.sgst,
          cess: 0,
        }),
        emptyTax()
      );

    // s.17(5)(h) reversals (stock lost / destroyed / free samples) are credits to input GST in the
    // ledger; add them back to 4A(5) and report them in 4B(1).
    const rev = await pool.query(
      `SELECT a.account_code, COALESCE(SUM(l.credit - l.debit), 0) AS amt
         FROM ledger_entry_lines l
         JOIN accounts a ON a.id = l.account_id
        WHERE l.business_id = $1::uuid
          AND l.voucher_type = 'itc_reversal'
          AND a.account_code IN ($5, $6, $7)
          AND l.entry_date >= $2::date AND l.entry_date <= $3::date
          AND ($4::uuid IS NULL OR l.branch_id = $4::uuid)
        GROUP BY a.account_code`,
      [business_id, startOfMonth, endOfMonth, branch, GSTR3B_INPUT_IGST, GSTR3B_INPUT_CGST, GSTR3B_INPUT_SGST]
    );
    const revAmt = (code: string) => round2(Number(rev.rows.find((r) => r.account_code === code)?.amt ?? 0));
    const stockLossReversal = {
      igst: revAmt(GSTR3B_INPUT_IGST),
      cgst: revAmt(GSTR3B_INPUT_CGST),
      sgst: revAmt(GSTR3B_INPUT_SGST),
    };

    // 4A(5): books ITC less the credits reported in 4A(1)-(3), plus credit reversed in 4B(1).
    const otherHead = (ledger: number, head: 'igst' | 'cgst' | 'sgst') =>
      round2(
        Math.max(0, ledger + stockLossReversal[head] - itcImports[head] - itcImportServices[head] - itcRcm[head]) +
          blocked[head]
      );
    const other_itc: TaxBreakdown = {
      taxable_value: 0,
      igst: otherHead(itcIGST, 'igst'),
      cgst: otherHead(itcCGST, 'cgst'),
      sgst: otherHead(itcSGST, 'sgst'),
      cess: round2(itcCess),
    };
    const itc_reversed: TaxBreakdown = roundTax({
      taxable_value: 0,
      igst: blocked.igst + stockLossReversal.igst,
      cgst: blocked.cgst + stockLossReversal.cgst,
      sgst: blocked.sgst + stockLossReversal.sgst,
      cess: 0,
    });
    const net_itc: TaxBreakdown = roundTax({
      taxable_value: 0,
      igst: itcImports.igst + itcImportServices.igst + itcRcm.igst + other_itc.igst - itc_reversed.igst,
      cgst: itcImports.cgst + itcImportServices.cgst + itcRcm.cgst + other_itc.cgst - itc_reversed.cgst,
      sgst: itcImports.sgst + itcImportServices.sgst + itcRcm.sgst + other_itc.sgst - itc_reversed.sgst,
      cess: other_itc.cess,
    });
    const itcFromDocs = round2(itcImports.igst + itcImportServices.igst + itcRcm.igst);
    if (itcFromDocs > round2(itcIGST) + 0.5 || itcRcm.cgst > round2(itcCGST) + 0.5 || itcRcm.sgst > round2(itcSGST) + 0.5) {
      warnings.push('Import / reverse-charge ITC on bills exceeds input GST in the ledger for the period — check that RCM ITC was booked.');
    }

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
      non_gst_outward_supplies,
      inter_state_supplies_unregistered,
      itc_details: {
        imports: itcImports,
        import_services: itcImportServices,
        inward_reverse_charge: itcRcm,
        other_itc,
        itc_reversed,
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
