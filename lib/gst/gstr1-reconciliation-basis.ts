import { round2 } from '@/lib/gst/gstr3b-ledger';
import type {
  B2BInvoice,
  B2CLInvoice,
  B2CSInvoice,
  CDNEntry,
  ExportInvoice,
  GSTR1Summary,
  SEZInvoice,
} from '@/lib/gst/gstr1';

/** Tax heads + taxable (domestic-style) from a live or snapshotted GSTR-1 bundle. */
export interface Gstr1OutputByHead {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** Sum of taxable from B2B+B2CL+B2CS only (excludes export/SEZ); mirrors GSTR-3B outward_taxable_supplies.taxable_value scope. */
  taxable_value_domestic: number;
}

type Gstr1BundleLike = {
  summary: GSTR1Summary;
  b2b: B2BInvoice[];
  b2cl: B2CLInvoice[];
  b2cs: B2CSInvoice[];
  exports: ExportInvoice[];
  sez: SEZInvoice[];
  cdn: CDNEntry[];
};

function sumTaxableDomestic(b: Gstr1BundleLike): number {
  return round2(
    b.b2b.reduce((s, r) => s + r.taxable_value, 0) +
      b.b2cl.reduce((s, r) => s + r.taxable_value, 0) +
      b.b2cs.reduce((s, r) => s + r.taxable_value, 0)
  );
}

/**
 * Aggregate IGST/CGST/SGST/CESS from GSTR-1 sections (invoice + CDN; notes adjust).
 * Export/SEZ IGST included in igst total (same as prior `gstr1OutputTaxByHead`).
 */
export function aggregateGstr1OutputByHead(data: Gstr1BundleLike): Gstr1OutputByHead {
  let igst = 0;
  let cgst = 0;
  let sgst = 0;
  let cess = 0;

  const addCess = (n: number) => {
    cess += n;
  };

  for (const r of data.b2b) {
    igst += r.igst_amount;
    cgst += r.cgst_amount;
    sgst += r.sgst_amount;
    addCess(r.cess_amount);
  }
  for (const r of data.b2cl) {
    igst += r.igst_amount;
    addCess(r.cess_amount);
  }
  for (const r of data.b2cs) {
    igst += r.igst_amount;
    cgst += r.cgst_amount;
    sgst += r.sgst_amount;
    addCess(r.cess_amount);
  }
  for (const r of data.exports) {
    igst += r.igst_amount;
  }
  for (const r of data.sez) {
    igst += r.igst_amount;
    addCess(r.cess_amount);
  }
  for (const n of data.cdn) {
    const s = n.note_type === 'C' ? -1 : 1;
    igst += s * n.igst_amount;
    cgst += s * n.cgst_amount;
    sgst += s * n.sgst_amount;
    addCess(s * n.cess_amount);
  }

  return {
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    cess: round2(cess),
    taxable_value_domestic: sumTaxableDomestic(data),
  };
}

export interface ReconciliationHeadRow {
  ledger: number;
  gstr1: number;
  difference: number;
  status: 'matched' | 'mismatch';
}

const HEAD_TOLERANCE = 1;

export function reconciliationByHead(params: {
  ledger: { igst: number; cgst: number; sgst: number; cess: number };
  gstr1: { igst: number; cgst: number; sgst: number; cess: number };
}): {
  igst: ReconciliationHeadRow;
  cgst: ReconciliationHeadRow;
  sgst: ReconciliationHeadRow;
  cess: ReconciliationHeadRow;
} {
  const mk = (ledger: number, gstr1: number): ReconciliationHeadRow => {
    const difference = round2(ledger - gstr1);
    return {
      ledger: round2(ledger),
      gstr1: round2(gstr1),
      difference,
      status: Math.abs(difference) <= HEAD_TOLERANCE ? 'matched' : 'mismatch',
    };
  };
  return {
    igst: mk(params.ledger.igst, params.gstr1.igst),
    cgst: mk(params.ledger.cgst, params.gstr1.cgst),
    sgst: mk(params.ledger.sgst, params.gstr1.sgst),
    cess: mk(params.ledger.cess, params.gstr1.cess),
  };
}
