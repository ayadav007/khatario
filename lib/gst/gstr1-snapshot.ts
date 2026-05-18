import { aggregateGstr1OutputByHead } from '@/lib/gst/gstr1-reconciliation-basis';
import { GSTR1Generator, type HSNEntry } from '@/lib/gst/gstr1';

export const GSTR1_FILING_SNAPSHOT_VERSION = 1 as const;

type Gstr1Bundle = Awaited<ReturnType<InstanceType<typeof GSTR1Generator>['generate']>>;

export interface Gstr1FilingSnapshotV1 {
  version: typeof GSTR1_FILING_SNAPSHOT_VERSION;
  generated_at: string;
  gst_period: string;
  business_id: string;
  branch_id: string;

  totals: {
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    taxable_value: number;
  };

  breakdown: {
    b2b: { count: number; taxable_value: number; igst: number; cgst: number; sgst: number; cess: number };
    b2cl: { count: number; taxable_value: number; igst: number; cess: number };
    b2cs: { count: number; taxable_value: number; igst: number; cgst: number; sgst: number; cess: number };
    exports: { count: number; taxable_value: number; igst: number };
    sez: { count: number; taxable_value: number; igst: number; cess: number };
    cdn: { count: number; taxable_value: number; igst: number; cgst: number; sgst: number; cess: number };
  };

  hsn_summary: HSNEntry[];

  /** Same basis as GSTR-3B output-tax reconciliation (GSTR-1 derived). */
  reconciliation_basis: {
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };
}

function sectionTotalsB2b(rows: Gstr1Bundle['b2b']) {
  return rows.reduce(
    (a, r) => ({
      taxable_value: a.taxable_value + r.taxable_value,
      igst: a.igst + r.igst_amount,
      cgst: a.cgst + r.cgst_amount,
      sgst: a.sgst + r.sgst_amount,
      cess: a.cess + r.cess_amount,
    }),
    { taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
  );
}

function sectionTotalsB2cl(rows: Gstr1Bundle['b2cl']) {
  return rows.reduce(
    (a, r) => ({
      taxable_value: a.taxable_value + r.taxable_value,
      igst: a.igst + r.igst_amount,
      cess: a.cess + r.cess_amount,
    }),
    { taxable_value: 0, igst: 0, cess: 0 }
  );
}

function sectionTotalsB2cs(rows: Gstr1Bundle['b2cs']) {
  return rows.reduce(
    (a, r) => ({
      taxable_value: a.taxable_value + r.taxable_value,
      igst: a.igst + r.igst_amount,
      cgst: a.cgst + r.cgst_amount,
      sgst: a.sgst + r.sgst_amount,
      cess: a.cess + r.cess_amount,
    }),
    { taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
  );
}

function sectionTotalsExp(rows: Gstr1Bundle['exports']) {
  return rows.reduce(
    (a, r) => ({
      taxable_value: a.taxable_value + r.taxable_value,
      igst: a.igst + r.igst_amount,
    }),
    { taxable_value: 0, igst: 0 }
  );
}

function sectionTotalsSez(rows: Gstr1Bundle['sez']) {
  return rows.reduce(
    (a, r) => ({
      taxable_value: a.taxable_value + r.taxable_value,
      igst: a.igst + r.igst_amount,
      cess: a.cess + r.cess_amount,
    }),
    { taxable_value: 0, igst: 0, cess: 0 }
  );
}

function sectionTotalsCdn(rows: Gstr1Bundle['cdn']) {
  return rows.reduce(
    (a, n) => {
      const s = n.note_type === 'C' ? -1 : 1;
      return {
        taxable_value: a.taxable_value + s * n.taxable_value,
        igst: a.igst + s * n.igst_amount,
        cgst: a.cgst + s * n.cgst_amount,
        sgst: a.sgst + s * n.sgst_amount,
        cess: a.cess + s * n.cess_amount,
      };
    },
    { taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 }
  );
}

/**
 * Immutable point-in-time GSTR-1 snapshot for audit (store on file only).
 */
export function buildGstr1Snapshot(
  bundle: Gstr1Bundle,
  ctx: { generatedAt: string; gstPeriod: string; businessId: string; branchId: string }
): Gstr1FilingSnapshotV1 {
  const basis = aggregateGstr1OutputByHead(bundle);
  const tb = sectionTotalsB2b(bundle.b2b);
  const tl = sectionTotalsB2cl(bundle.b2cl);
  const ts = sectionTotalsB2cs(bundle.b2cs);
  const te = sectionTotalsExp(bundle.exports);
  const tz = sectionTotalsSez(bundle.sez);
  const tc = sectionTotalsCdn(bundle.cdn);

  const snap: Gstr1FilingSnapshotV1 = {
    version: GSTR1_FILING_SNAPSHOT_VERSION,
    generated_at: ctx.generatedAt,
    gst_period: ctx.gstPeriod,
    business_id: ctx.businessId,
    branch_id: ctx.branchId,
    totals: {
      igst: basis.igst,
      cgst: basis.cgst,
      sgst: basis.sgst,
      cess: basis.cess,
      taxable_value: bundle.summary.total_outward_taxable_supplies,
    },
    breakdown: {
      b2b: {
        count: bundle.b2b.length,
        taxable_value: tb.taxable_value,
        igst: tb.igst,
        cgst: tb.cgst,
        sgst: tb.sgst,
        cess: tb.cess,
      },
      b2cl: {
        count: bundle.b2cl.length,
        taxable_value: tl.taxable_value,
        igst: tl.igst,
        cess: tl.cess,
      },
      b2cs: {
        count: bundle.b2cs.length,
        taxable_value: ts.taxable_value,
        igst: ts.igst,
        cgst: ts.cgst,
        sgst: ts.sgst,
        cess: ts.cess,
      },
      exports: {
        count: bundle.exports.length,
        taxable_value: te.taxable_value,
        igst: te.igst,
      },
      sez: {
        count: bundle.sez.length,
        taxable_value: tz.taxable_value,
        igst: tz.igst,
        cess: tz.cess,
      },
      cdn: {
        count: bundle.cdn.length,
        taxable_value: tc.taxable_value,
        igst: tc.igst,
        cgst: tc.cgst,
        sgst: tc.sgst,
        cess: tc.cess,
      },
    },
    hsn_summary: JSON.parse(JSON.stringify(bundle.hsn)) as HSNEntry[],
    reconciliation_basis: {
      igst: basis.igst,
      cgst: basis.cgst,
      sgst: basis.sgst,
      cess: basis.cess,
    },
  };

  return snap;
}

export function parseGstr1FilingSnapshot(raw: unknown): Gstr1FilingSnapshotV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== GSTR1_FILING_SNAPSHOT_VERSION) return null;
  if (typeof o.generated_at !== 'string' || typeof o.gst_period !== 'string') return null;
  return raw as Gstr1FilingSnapshotV1;
}
