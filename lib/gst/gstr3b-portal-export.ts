import { queryOne } from '@/lib/db';
import { GSTR3BGenerator, type GSTR3BData } from '@/lib/gst/gstr3b';
import { getGstFilingForScope } from '@/lib/gst/gst-filing';
import { round2 } from '@/lib/gst/gstr3b-ledger';

/** GST portal financial period: MMYYYY (e.g. 2026-04 → 042026). */
export function formatGstr3BFinancialPeriod(gstPeriod: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(gstPeriod.trim());
  if (!m) {
    throw new Error('gst_period must be YYYY-MM');
  }
  const year = m[1];
  const month = m[2];
  return `${month}${year}`;
}

function nz(n: unknown): number {
  return round2(Number(n) || 0);
}

export interface Gstr3BPortalSupDetails {
  osup_det: { txval: number; iamt: number; camt: number; samt: number };
  osup_zero: Record<string, never>;
  osup_nil_exmp: Record<string, never>;
  isup_rev: { iamt: number; camt: number; samt: number };
}

export interface Gstr3BPortalItcElg {
  itc_avl: { iamt: number; camt: number; samt: number };
  itc_rev: Record<string, never>;
  itc_net: { iamt: number; camt: number; samt: number };
}

export interface Gstr3BPortalTaxPmt {
  tx_pyble: { iamt: number; camt: number; samt: number };
}

export interface Gstr3BPortalExportBody {
  gstin: string | null;
  fp: string;
  version: string;
  sup_details: Gstr3BPortalSupDetails;
  itc_elg: Gstr3BPortalItcElg;
  tax_pmt: Gstr3BPortalTaxPmt;
  generated_at: string;
  source: 'snapshot' | 'live';
}

function buildPortalPayloadFromGstr3b(data: GSTR3BData): Omit<Gstr3BPortalExportBody, 'gstin' | 'fp' | 'version' | 'generated_at' | 'source'> {
  const ot = data.outward_taxable_supplies;
  const ir = data.inward_reverse_charge;
  const itc = data.itc;
  const netItc = data.itc_details.net_itc;
  const np = data.net_payable;

  return {
    sup_details: {
      osup_det: {
        txval: nz(ot.taxable_value),
        iamt: nz(ot.igst),
        camt: nz(ot.cgst),
        samt: nz(ot.sgst),
      },
      osup_zero: {},
      osup_nil_exmp: {},
      isup_rev: {
        iamt: nz(ir.igst),
        camt: nz(ir.cgst),
        samt: nz(ir.sgst),
      },
    },
    itc_elg: {
      itc_avl: {
        iamt: nz(itc.igst),
        camt: nz(itc.cgst),
        samt: nz(itc.sgst),
      },
      itc_rev: {},
      itc_net: {
        iamt: nz(netItc.igst),
        camt: nz(netItc.cgst),
        samt: nz(netItc.sgst),
      },
    },
    tax_pmt: {
      tx_pyble: {
        iamt: nz(np.igst),
        camt: nz(np.cgst),
        samt: nz(np.sgst),
      },
    },
  };
}

async function loadLiveGstr3b(businessId: string, branchId: string, gstPeriod: string): Promise<GSTR3BData> {
  const m = /^(\d{4})-(\d{2})$/.exec(gstPeriod.trim());
  if (!m) {
    throw new Error('gst_period must be YYYY-MM');
  }
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const gen = new GSTR3BGenerator();
  return gen.generate({
    business_id: businessId,
    month,
    year,
    branch_id: branchId,
  });
}

/**
 * Resolve GSTR-3B data: **snapshot** when return is `filed` or `revised` and `gst_snapshot` exists;
 * otherwise **live** from `GSTR3BGenerator`.
 * If status is `filed`/`revised` but snapshot is missing, throws (audit consistency).
 */
export async function resolveGstr3BDataForPortalExport(params: {
  businessId: string;
  branchId: string;
  gstPeriod: string;
}): Promise<{ data: GSTR3BData; source: 'snapshot' | 'live' }> {
  const { businessId, branchId, gstPeriod } = params;
  formatGstr3BFinancialPeriod(gstPeriod);

  const filing = await getGstFilingForScope(businessId, branchId, gstPeriod);

  if (
    filing &&
    (filing.status === 'filed' || filing.status === 'revised') &&
    filing.gst_snapshot
  ) {
    const raw = filing.gst_snapshot.gstr3b;
    if (raw == null) {
      throw new Error('No GST data available');
    }
    const data = raw as GSTR3BData;
    if (!data.outward_taxable_supplies || !data.net_payable || !data.itc_details?.net_itc) {
      throw new Error('No GST data available');
    }
    return { data, source: 'snapshot' };
  }

  if (filing && (filing.status === 'filed' || filing.status === 'revised') && !filing.gst_snapshot) {
    throw new Error(
      'No GST filing snapshot for this period — cannot export filed return; complete migration or re-file after snapshot support.'
    );
  }

  const data = await loadLiveGstr3b(businessId, branchId, gstPeriod);
  if (!data.outward_taxable_supplies || !data.net_payable || !data.itc_details?.net_itc) {
    throw new Error('No GST data available');
  }
  return { data, source: 'live' };
}

/**
 * Portal-aligned GSTR-3B JSON (subset of GST JSON schema) for audit / future API filing.
 */
export async function getGstr3BPortalExport(params: {
  businessId: string;
  branchId: string;
  gstPeriod: string;
}): Promise<Gstr3BPortalExportBody> {
  const { businessId, branchId, gstPeriod } = params;
  const { data, source } = await resolveGstr3BDataForPortalExport(params);

  const biz = await queryOne<{ gstin: string | null }>(
    `SELECT gstin FROM businesses WHERE id = $1::uuid LIMIT 1`,
    [businessId]
  );

  const core = buildPortalPayloadFromGstr3b(data);
  const generated_at = new Date().toISOString();

  return {
    gstin: biz?.gstin ?? null,
    fp: formatGstr3BFinancialPeriod(gstPeriod),
    version: '1.0',
    ...core,
    generated_at,
    source,
  };
}
