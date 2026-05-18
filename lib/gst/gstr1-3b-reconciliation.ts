import { getPool, queryOne } from '@/lib/db';
import type { GstFilingSnapshot } from '@/lib/gst/gst-filing';
import { getGstFilingForScope } from '@/lib/gst/gst-filing';
import type { B2BInvoice, B2CLInvoice } from '@/lib/gst/gstr1';
import { GSTR1Generator } from '@/lib/gst/gstr1';
import { aggregateGstr1OutputByHead } from '@/lib/gst/gstr1-reconciliation-basis';
import { parseGstr1FilingSnapshot, type Gstr1FilingSnapshotV1 } from '@/lib/gst/gstr1-snapshot';
import { calendarMonthBounds } from '@/lib/gst/gst-period-lock';
import type { GSTR3BData } from '@/lib/gst/gstr3b';
import { GSTR3BGenerator } from '@/lib/gst/gstr3b';
import {
  GSTR3B_OUTPUT_CESS,
  GSTR3B_OUTPUT_CGST,
  GSTR3B_OUTPUT_IGST,
  GSTR3B_OUTPUT_SGST,
  hasInvoiceLedgerEntryDateMismatch,
  round2,
} from '@/lib/gst/gstr3b-ledger';

export type Gstr13bReconciliationMode = 'live_vs_live' | 'filed_vs_live' | 'filed_vs_filed';

export type ReconciliationParams = {
  businessId: string;
  gstPeriod: string;
  branchId: string;
  mode: Gstr13bReconciliationMode;
};

const TOLERANCE = 1;

export type ReconciliationException = {
  type: 'missing_invoice' | 'extra_invoice' | 'tax_mismatch' | 'date_mismatch' | 'cdn_mismatch';
  invoice_id?: string;
  document_id?: string;
  voucher_type?: 'invoice' | 'credit_note' | 'debit_note';
  difference?: number;
  details: string;
};

export type HeadCompare = {
  gstr1: number;
  gstr3b: number;
  difference: number;
  status: 'matched' | 'mismatch';
};

export type CategoryTaxBlock = {
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
};

export type CategoryCompare = {
  gstr1: CategoryTaxBlock;
  gstr3b: CategoryTaxBlock;
  difference: CategoryTaxBlock;
  note?: string;
};

export type VoucherTaxRow = {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  taxable_value: number;
  voucher_type: 'invoice' | 'credit_note' | 'debit_note';
};

export type InvoiceReconciliationRow = {
  voucher_key: string;
  voucher_type: 'invoice' | 'credit_note' | 'debit_note';
  document_id: string;
  status: 'matched' | 'missing_in_3b' | 'missing_in_1' | 'value_mismatch';
  gstr1: Pick<VoucherTaxRow, 'igst' | 'cgst' | 'sgst' | 'cess' | 'taxable_value'>;
  ledger: Pick<VoucherTaxRow, 'igst' | 'cgst' | 'sgst' | 'cess'>;
  /** Max absolute head difference for value_mismatch */
  max_head_diff?: number;
};

export type Gstr13bReconciliationResult = {
  status: 'matched' | 'mismatch';
  mode: Gstr13bReconciliationMode;
  gst_period: string;
  branch_id: string;
  meta: {
    gstr1_head_source: 'filed_snapshot' | 'live_generator';
    gstr3b_source: 'filed_snapshot' | 'live_generator';
    /** Invoice/CDN line map is always from live DB read (same stored amounts as GSTR-1); may differ from filed snapshot if books changed post-file. */
    voucher_map_source: 'live_gstr1_generator';
    gstr1_snapshot_branch_id?: string;
    gstr1_filing_status?: string;
    gst_filing_status?: string;
  };
  head_wise: {
    igst: HeadCompare;
    cgst: HeadCompare;
    sgst: HeadCompare;
    cess: HeadCompare;
  };
  totals: {
    gstr1: number;
    gstr3b: number;
    difference: number;
  };
  categories: {
    outward_taxable: CategoryCompare;
    zero_rated: CategoryCompare;
    exempt: CategoryCompare;
    nil_rated: CategoryCompare;
    inward_rcm: CategoryCompare;
    cdn_adjustments: CategoryCompare;
  };
  exceptions: ReconciliationException[];
  stats: {
    total_vouchers_compared: number;
    matched: number;
    mismatched: number;
    missing_in_ledger: number;
    missing_in_gstr1: number;
    b2cs_aggregated_rows: number;
  };
  vouchers: InvoiceReconciliationRow[];
  warnings: string[];
};

function assertPeriod(p: string): void {
  if (!/^\d{4}-\d{2}$/.test(p.trim())) {
    throw new Error('gstPeriod must be YYYY-MM');
  }
}

function compareHead(g1: number, g3: number): HeadCompare {
  const difference = round2(g1 - g3);
  return {
    gstr1: round2(g1),
    gstr3b: round2(g3),
    difference,
    status: Math.abs(difference) <= TOLERANCE ? 'matched' : 'mismatch',
  };
}

function emptyBlock(): CategoryTaxBlock {
  return { taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
}

function subBlock(a: CategoryTaxBlock, b: CategoryTaxBlock): CategoryTaxBlock {
  return {
    taxable_value: round2(a.taxable_value - b.taxable_value),
    igst: round2(a.igst - b.igst),
    cgst: round2(a.cgst - b.cgst),
    sgst: round2(a.sgst - b.sgst),
    cess: round2(a.cess - b.cess),
  };
}

function extractGstr3bOutputHeads(d: GSTR3BData): { igst: number; cgst: number; sgst: number; cess: number } {
  const cess = d.gross_output_tax?.cess ?? 0;
  return {
    igst: round2(d.ledger_basis.outward_supplies.igst),
    cgst: round2(d.ledger_basis.outward_supplies.cgst),
    sgst: round2(d.ledger_basis.outward_supplies.sgst),
    cess: round2(cess),
  };
}

function gstr1HeadsFromSnapshot(s: Gstr1FilingSnapshotV1): { igst: number; cgst: number; sgst: number; cess: number } {
  const b = s.reconciliation_basis;
  return {
    igst: round2(b.igst),
    cgst: round2(b.cgst),
    sgst: round2(b.sgst),
    cess: round2(b.cess),
  };
}

function categoriesFromGstr1Bundle(
  bundle: Awaited<ReturnType<InstanceType<typeof GSTR1Generator>['generate']>>
): {
  outward_taxable: CategoryTaxBlock;
  zero_rated: CategoryTaxBlock;
  exempt: CategoryTaxBlock;
  nil_rated: CategoryTaxBlock;
  cdn_adjustments: CategoryTaxBlock;
  b2cs_count: number;
} {
  const outward = emptyBlock();
  for (const r of bundle.b2b) {
    outward.taxable_value += r.taxable_value;
    outward.igst += r.igst_amount;
    outward.cgst += r.cgst_amount;
    outward.sgst += r.sgst_amount;
    outward.cess += r.cess_amount;
  }
  for (const r of bundle.b2cl) {
    outward.taxable_value += r.taxable_value;
    outward.igst += r.igst_amount;
    outward.cess += r.cess_amount;
  }
  for (const r of bundle.b2cs) {
    outward.taxable_value += r.taxable_value;
    outward.igst += r.igst_amount;
    outward.cgst += r.cgst_amount;
    outward.sgst += r.sgst_amount;
    outward.cess += r.cess_amount;
  }
  const zero = emptyBlock();
  for (const r of bundle.exports) {
    zero.taxable_value += r.taxable_value;
    zero.igst += r.igst_amount;
  }
  for (const r of bundle.sez) {
    zero.taxable_value += r.taxable_value;
    zero.igst += r.igst_amount;
    zero.cess += (r as { cess_amount: number }).cess_amount ?? 0;
  }

  const exempt = emptyBlock();
  const nilRated = emptyBlock();
  for (const n of bundle.nil) {
    exempt.taxable_value += n.exempt_supply + n.non_gst_supply;
    nilRated.taxable_value += n.nil_supply;
  }

  const cdn = emptyBlock();
  for (const n of bundle.cdn) {
    const s = n.note_type === 'C' ? -1 : 1;
    cdn.taxable_value += s * n.taxable_value;
    cdn.igst += s * n.igst_amount;
    cdn.cgst += s * n.cgst_amount;
    cdn.sgst += s * n.sgst_amount;
    cdn.cess += s * n.cess_amount;
  }

  return {
    outward_taxable: {
      taxable_value: round2(outward.taxable_value),
      igst: round2(outward.igst),
      cgst: round2(outward.cgst),
      sgst: round2(outward.sgst),
      cess: round2(outward.cess),
    },
    zero_rated: {
      taxable_value: round2(zero.taxable_value),
      igst: round2(zero.igst),
      cgst: 0,
      sgst: 0,
      cess: round2(zero.cess),
    },
    exempt: {
      taxable_value: round2(exempt.taxable_value),
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    },
    nil_rated: {
      taxable_value: round2(nilRated.taxable_value),
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    },
    cdn_adjustments: {
      taxable_value: round2(cdn.taxable_value),
      igst: round2(cdn.igst),
      cgst: round2(cdn.cgst),
      sgst: round2(cdn.sgst),
      cess: round2(cdn.cess),
    },
    b2cs_count: bundle.b2cs.length,
  };
}

function categoriesFromGstr3b(d: GSTR3BData): {
  outward_taxable: CategoryTaxBlock;
  zero_rated: CategoryTaxBlock;
  exempt: CategoryTaxBlock;
  nil_rated: CategoryTaxBlock;
  inward_rcm: CategoryTaxBlock;
} {
  const o = d.outward_taxable_supplies;
  const z = d.outward_zero_rated;
  const other = d.other_outward_supplies;
  const rcm = d.inward_reverse_charge;

  return {
    outward_taxable: {
      taxable_value: round2(o.taxable_value),
      igst: round2(o.igst),
      cgst: round2(o.cgst),
      sgst: round2(o.sgst),
      cess: round2(o.cess),
    },
    zero_rated: {
      taxable_value: round2(z.taxable_value),
      igst: round2(z.igst),
      cgst: round2(z.cgst),
      sgst: round2(z.sgst),
      cess: round2(z.cess),
    },
    exempt: {
      taxable_value: round2(other.taxable_value),
      igst: round2(other.igst),
      cgst: round2(other.cgst),
      sgst: round2(other.sgst),
      cess: round2(other.cess),
    },
    nil_rated: {
      taxable_value: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
    },
    inward_rcm: {
      taxable_value: round2(rcm.taxable_value),
      igst: round2(rcm.igst),
      cgst: round2(rcm.cgst),
      sgst: round2(rcm.sgst),
      cess: round2(rcm.cess),
    },
  };
}

function mkCategoryCompare(g1: CategoryTaxBlock, g3: CategoryTaxBlock, note?: string): CategoryCompare {
  return {
    gstr1: g1,
    gstr3b: g3,
    difference: subBlock(g1, g3),
    ...(note ? { note } : {}),
  };
}

type Bundle = Awaited<ReturnType<InstanceType<typeof GSTR1Generator>['generate']>>;

function buildGstr1VoucherMap(bundle: Bundle): Map<string, VoucherTaxRow> {
  const map = new Map<string, VoucherTaxRow>();

  const add = (key: string, vt: VoucherTaxRow['voucher_type'], partial: Partial<VoucherTaxRow> & Pick<VoucherTaxRow, 'igst' | 'cgst' | 'sgst' | 'cess'>) => {
    const prev = map.get(key);
    const row: VoucherTaxRow = {
      igst: round2((prev?.igst ?? 0) + partial.igst),
      cgst: round2((prev?.cgst ?? 0) + partial.cgst),
      sgst: round2((prev?.sgst ?? 0) + partial.sgst),
      cess: round2((prev?.cess ?? 0) + partial.cess),
      taxable_value: round2((prev?.taxable_value ?? 0) + (partial.taxable_value ?? 0)),
      voucher_type: vt,
    };
    map.set(key, row);
  };

  const invRows = [...bundle.b2b, ...bundle.b2cl, ...bundle.exports, ...bundle.sez] as Array<
    B2BInvoice | B2CLInvoice | Bundle['exports'][number] | Bundle['sez'][number]
  >;
  for (const r of invRows) {
    const id = r.invoice_id;
    if (!id) continue;
    const key = `invoice:${id}`;
    const cgst = 'cgst_amount' in r ? (r as B2BInvoice).cgst_amount : 0;
    const sgst = 'sgst_amount' in r ? (r as B2BInvoice).sgst_amount : 0;
    const cess =
      'cess_amount' in r
        ? (r as B2BInvoice | B2CLInvoice | Bundle['sez'][number]).cess_amount
        : 0;
    add(key, 'invoice', {
      igst: r.igst_amount,
      cgst,
      sgst,
      cess,
      taxable_value: r.taxable_value,
    });
  }

  for (const n of bundle.cdn) {
    const key = `${n.document_type}:${n.document_id}`;
    const s = n.note_type === 'C' ? -1 : 1;
    add(key, n.document_type, {
      igst: s * n.igst_amount,
      cgst: s * n.cgst_amount,
      sgst: s * n.sgst_amount,
      cess: s * n.cess_amount,
      taxable_value: s * n.taxable_value,
    });
  }

  return map;
}

async function fetchLedgerOutputByVoucher(
  businessId: string,
  fromDate: string,
  toDate: string,
  branchId: string
): Promise<Map<string, VoucherTaxRow>> {
  const pool = getPool();
  const { rows } = await pool.query<{
    voucher_id: string;
    voucher_type: string;
    account_code: string;
    net: string;
  }>(
    `
    SELECT lel.voucher_id::text AS voucher_id,
           lel.voucher_type,
           a.account_code,
           SUM(lel.credit - lel.debit)::text AS net
    FROM ledger_entry_lines lel
    INNER JOIN accounts a ON a.id = lel.account_id AND a.business_id = lel.business_id
    WHERE lel.business_id = $1::uuid
      AND lel.entry_date >= $2::date
      AND lel.entry_date <= $3::date
      AND (lel.branch_id IS NULL OR lel.branch_id = $4::uuid)
      AND lel.voucher_type IN ('invoice', 'credit_note', 'debit_note')
      AND a.account_code = ANY($5::text[])
    GROUP BY lel.voucher_id, lel.voucher_type, a.account_code
    `,
    [
      businessId,
      fromDate,
      toDate,
      branchId,
      [GSTR3B_OUTPUT_IGST, GSTR3B_OUTPUT_CGST, GSTR3B_OUTPUT_SGST, GSTR3B_OUTPUT_CESS],
    ]
  );

  const map = new Map<string, VoucherTaxRow>();
  for (const r of rows) {
    const key = `${r.voucher_type}:${r.voucher_id}`;
    const net = round2(parseFloat(r.net ?? '0'));
    const vt = r.voucher_type as VoucherTaxRow['voucher_type'];
    const prev = map.get(key);
    const base: VoucherTaxRow = prev ?? {
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
      taxable_value: 0,
      voucher_type: vt,
    };
    if (r.account_code === GSTR3B_OUTPUT_IGST) base.igst = round2(base.igst + net);
    else if (r.account_code === GSTR3B_OUTPUT_CGST) base.cgst = round2(base.cgst + net);
    else if (r.account_code === GSTR3B_OUTPUT_SGST) base.sgst = round2(base.sgst + net);
    else if (r.account_code === GSTR3B_OUTPUT_CESS) base.cess = round2(base.cess + net);
    base.voucher_type = vt;
    map.set(key, base);
  }
  return map;
}

async function fetchInvoiceDateMismatchIds(
  businessId: string,
  fromDate: string,
  toDate: string,
  branchId: string
): Promise<Set<string>> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `
    SELECT DISTINCT i.id::text AS id
    FROM ledger_entry_lines lel
    INNER JOIN invoices i ON i.id = lel.voucher_id AND lel.voucher_type = 'invoice' AND i.deleted_at IS NULL
    WHERE lel.business_id = $1::uuid
      AND lel.entry_date >= $2::date
      AND lel.entry_date <= $3::date
      AND (lel.branch_id IS NULL OR lel.branch_id = $4::uuid)
      AND i.invoice_date IS DISTINCT FROM lel.entry_date
    `,
    [businessId, fromDate, toDate, branchId]
  );
  return new Set(rows.map((r) => r.id));
}

async function assertOutputAccountsExist(businessId: string): Promise<{ ok: boolean; missing: string[] }> {
  const pool = getPool();
  const codes = [GSTR3B_OUTPUT_IGST, GSTR3B_OUTPUT_CGST, GSTR3B_OUTPUT_SGST, GSTR3B_OUTPUT_CESS];
  const { rows } = await pool.query<{ account_code: string }>(
    `
    SELECT account_code FROM accounts
    WHERE business_id = $1::uuid AND account_code = ANY($2::text[])
    `,
    [businessId, codes]
  );
  const have = new Set(rows.map((r) => r.account_code));
  const missing = codes.filter((c) => !have.has(c));
  return { ok: missing.length === 0, missing };
}

function parseVoucherKey(key: string): { type: VoucherTaxRow['voucher_type']; id: string } {
  const i = key.indexOf(':');
  const type = key.slice(0, i) as VoucherTaxRow['voucher_type'];
  const id = key.slice(i + 1);
  return { type, id };
}

/**
 * Full GSTR-1 vs GSTR-3B reconciliation: head-wise, category hints, voucher-level, exceptions.
 * Does not recompute tax formulas — uses generator snapshots and stored ledger lines.
 */
export async function runGstr13bReconciliation(params: ReconciliationParams): Promise<Gstr13bReconciliationResult> {
  const { businessId, gstPeriod, branchId, mode } = params;
  assertPeriod(gstPeriod);
  const { start, end } = calendarMonthBounds(gstPeriod.trim());
  const warnings: string[] = [];

  const [y, m] = gstPeriod.split('-').map((x) => parseInt(x, 10));
  const gstr1Gen = new GSTR1Generator();
  const liveBundle = await gstr1Gen.generate({
    business_id: businessId,
    branch_id: branchId,
    month: m,
    year: y,
  });

  let gstr1Heads: { igst: number; cgst: number; sgst: number; cess: number };
  let gstr1HeadSource: 'filed_snapshot' | 'live_generator' = 'live_generator';
  let snapMeta: { branch?: string; filingStatus?: string } = {};

  if (mode === 'filed_vs_live' || mode === 'filed_vs_filed') {
    const row = await queryOne<{
      gstr1_snapshot: unknown;
      status: string;
    }>(
      `
      SELECT gstr1_snapshot, status
      FROM gstr1_filings
      WHERE business_id = $1::uuid AND filing_period = $2
      LIMIT 1
      `,
      [businessId, gstPeriod.trim()]
    );
    const parsed = row?.gstr1_snapshot ? parseGstr1FilingSnapshot(row.gstr1_snapshot) : null;
    if (parsed) {
      gstr1Heads = gstr1HeadsFromSnapshot(parsed);
      gstr1HeadSource = 'filed_snapshot';
      snapMeta = { branch: parsed.branch_id, filingStatus: row?.status };
      if (parsed.branch_id !== branchId) {
        warnings.push(
          `GSTR-1 filed snapshot was built for branch ${parsed.branch_id}; current request uses ${branchId}.`
        );
      }
    } else {
      warnings.push(
        'No GSTR-1 filing snapshot for this period — falling back to live GSTR-1 totals for head-wise comparison.'
      );
      const agg = aggregateGstr1OutputByHead(liveBundle);
      gstr1Heads = { igst: agg.igst, cgst: agg.cgst, sgst: agg.sgst, cess: agg.cess };
    }
  } else {
    const agg = aggregateGstr1OutputByHead(liveBundle);
    gstr1Heads = { igst: agg.igst, cgst: agg.cgst, sgst: agg.sgst, cess: agg.cess };
  }

  let g3Data: GSTR3BData;
  let g3Source: 'filed_snapshot' | 'live_generator' = 'live_generator';
  let gstFilingStatus: string | undefined;

  if (mode === 'filed_vs_filed') {
    const filing = await getGstFilingForScope(businessId, branchId, gstPeriod.trim());
    const snap = filing?.gst_snapshot as GstFilingSnapshot | null | undefined;
    if (snap?.gstr3b) {
      g3Data = snap.gstr3b as GSTR3BData;
      g3Source = 'filed_snapshot';
      gstFilingStatus = filing?.status;
    } else {
      warnings.push(
        'No GSTR-3B filing snapshot — falling back to live GSTR-3B for this period.'
      );
      const gen = new GSTR3BGenerator();
      g3Data = await gen.generate({ business_id: businessId, month: m, year: y, branch_id: branchId });
    }
  } else {
    const gen = new GSTR3BGenerator();
    g3Data = await gen.generate({ business_id: businessId, month: m, year: y, branch_id: branchId });
  }

  const g3Heads = extractGstr3bOutputHeads(g3Data);

  const head_wise = {
    igst: compareHead(gstr1Heads.igst, g3Heads.igst),
    cgst: compareHead(gstr1Heads.cgst, g3Heads.cgst),
    sgst: compareHead(gstr1Heads.sgst, g3Heads.sgst),
    cess: compareHead(gstr1Heads.cess, g3Heads.cess),
  };

  const sumHeads = (h: { igst: number; cgst: number; sgst: number; cess: number }) =>
    round2(h.igst + h.cgst + h.sgst + h.cess);
  const tg1 = sumHeads(gstr1Heads);
  const tg3 = sumHeads(g3Heads);

  const catG1 = categoriesFromGstr1Bundle(liveBundle);
  const catG3 = categoriesFromGstr3b(g3Data);

  const categories = {
    outward_taxable: mkCategoryCompare(catG1.outward_taxable, catG3.outward_taxable),
    zero_rated: mkCategoryCompare(catG1.zero_rated, catG3.zero_rated),
    exempt: mkCategoryCompare(catG1.exempt, catG3.exempt),
    nil_rated: mkCategoryCompare(
      catG1.nil_rated,
      catG3.nil_rated,
      'GSTR-3B other_outward combines nil/exempt in other_outward_supplies; nil_rated split is approximate.'
    ),
    inward_rcm: mkCategoryCompare(
      emptyBlock(),
      catG3.inward_rcm,
      'RCM is not part of GSTR-1 outward supply; shown for 3B context only.'
    ),
    cdn_adjustments: mkCategoryCompare(
      catG1.cdn_adjustments,
      emptyBlock(),
      'CDN is embedded in net output ledgers for GSTR-3B; no separate voucher bucket in 3B JSON.'
    ),
  };

  const g1Map = buildGstr1VoucherMap(liveBundle);
  const ledgerMap = await fetchLedgerOutputByVoucher(businessId, start, end, branchId);
  const dateBad = await fetchInvoiceDateMismatchIds(businessId, start, end, branchId);

  if (gstr1HeadSource === 'filed_snapshot') {
    warnings.push(
      'Voucher-level comparison uses current invoice/CDN lines from the database (GSTR1Generator); filed snapshot supplies headline tax heads only.'
    );
  }

  if (catG1.b2cs_count > 0) {
    warnings.push(
      `B2CS has ${catG1.b2cs_count} aggregated row(s) in GSTR-1 — not expanded to per-invoice voucher keys.`
    );
  }

  const accCheck = await assertOutputAccountsExist(businessId);
  if (!accCheck.ok) {
    warnings.push(`Missing output GST ledger account(s): ${accCheck.missing.join(', ')} — ledger voucher map may be incomplete.`);
  }

  if (ledgerMap.size === 0 && tg1 > TOLERANCE) {
    warnings.push('No output GST ledger lines found for invoices/CDN in this period — check postings or branch scope.');
  }

  if (await hasInvoiceLedgerEntryDateMismatch(businessId, start, end, branchId)) {
    warnings.push(
      'Some invoice voucher lines use entry_date different from invoice_date — GSTR-1 is invoice-date based; GSTR-3B output uses entry_date.'
    );
  }

  for (const w of g3Data.warnings ?? []) {
    if (
      w.includes('Negative output') ||
      w.includes('mismatch') ||
      w.includes('RCM') ||
      w.includes('credit') ||
      w.includes('2153')
    ) {
      warnings.push(w);
    }
  }

  const exceptions: ReconciliationException[] = [];
  const vouchers: InvoiceReconciliationRow[] = [];
  const allKeys = new Set<string>([...g1Map.keys(), ...ledgerMap.keys()]);

  let matched = 0;
  let mismatched = 0;
  let missingInLedger = 0;
  let missingInGstr1 = 0;

  for (const key of allKeys) {
    const { type, id } = parseVoucherKey(key);
    const g1 = g1Map.get(key);
    const led = ledgerMap.get(key);

    if (type === 'invoice' && dateBad.has(id)) {
      exceptions.push({
        type: 'date_mismatch',
        invoice_id: id,
        voucher_type: 'invoice',
        details: 'invoice_date differs from at least one ledger entry_date for this invoice in the period.',
      });
    }

    if (g1 && !led) {
      const sum = round2(g1.igst + g1.cgst + g1.sgst + g1.cess);
      if (Math.abs(sum) > TOLERANCE) {
        missingInLedger++;
        if (type === 'credit_note' || type === 'debit_note') {
          exceptions.push({
            type: 'cdn_mismatch',
            document_id: id,
            voucher_type: type,
            details: `GSTR-1 shows CDN tax but no matching output GST ledger lines for ${key} in period (entry_date scope).`,
          });
        } else {
          exceptions.push({
            type: 'missing_invoice',
            invoice_id: id,
            details: 'GSTR-1 has tax for this invoice but no output GST ledger lines in period.',
          });
        }
        vouchers.push({
          voucher_key: key,
          voucher_type: type,
          document_id: id,
          status: 'missing_in_3b',
          gstr1: {
            igst: g1.igst,
            cgst: g1.cgst,
            sgst: g1.sgst,
            cess: g1.cess,
            taxable_value: g1.taxable_value,
          },
          ledger: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
        });
      }
      continue;
    }

    if (!g1 && led) {
      const sum = round2(led.igst + led.cgst + led.sgst + led.cess);
      if (Math.abs(sum) > TOLERANCE) {
        missingInGstr1++;
        exceptions.push({
          type: 'extra_invoice',
          invoice_id: type === 'invoice' ? id : undefined,
          document_id: type !== 'invoice' ? id : undefined,
          voucher_type: type,
          details: 'Ledger has output GST for this voucher but no matching GSTR-1 line (invoice date vs period, or missing document).',
        });
        vouchers.push({
          voucher_key: key,
          voucher_type: type,
          document_id: id,
          status: 'missing_in_1',
          gstr1: { igst: 0, cgst: 0, sgst: 0, cess: 0, taxable_value: 0 },
          ledger: { igst: led.igst, cgst: led.cgst, sgst: led.sgst, cess: led.cess },
        });
      }
      continue;
    }

    if (g1 && led) {
      const diffs = [
        Math.abs(round2(g1.igst - led.igst)),
        Math.abs(round2(g1.cgst - led.cgst)),
        Math.abs(round2(g1.sgst - led.sgst)),
        Math.abs(round2(g1.cess - led.cess)),
      ];
      const maxD = Math.max(...diffs);
      if (maxD <= TOLERANCE) {
        matched++;
        vouchers.push({
          voucher_key: key,
          voucher_type: type,
          document_id: id,
          status: 'matched',
          gstr1: {
            igst: g1.igst,
            cgst: g1.cgst,
            sgst: g1.sgst,
            cess: g1.cess,
            taxable_value: g1.taxable_value,
          },
          ledger: { igst: led.igst, cgst: led.cgst, sgst: led.sgst, cess: led.cess },
          max_head_diff: maxD,
        });
      } else {
        mismatched++;
        exceptions.push({
          type: 'tax_mismatch',
          invoice_id: type === 'invoice' ? id : undefined,
          document_id: type !== 'invoice' ? id : undefined,
          voucher_type: type,
          difference: maxD,
          details: `Tax heads differ by up to ${maxD} for ${key} (tolerance ₹${TOLERANCE}).`,
        });
        vouchers.push({
          voucher_key: key,
          voucher_type: type,
          document_id: id,
          status: 'value_mismatch',
          gstr1: {
            igst: g1.igst,
            cgst: g1.cgst,
            sgst: g1.sgst,
            cess: g1.cess,
            taxable_value: g1.taxable_value,
          },
          ledger: { igst: led.igst, cgst: led.cgst, sgst: led.sgst, cess: led.cess },
          max_head_diff: maxD,
        });
      }
    }
  }

  const headOk =
    head_wise.igst.status === 'matched' &&
    head_wise.cgst.status === 'matched' &&
    head_wise.sgst.status === 'matched' &&
    head_wise.cess.status === 'matched';
  const status: 'matched' | 'mismatch' =
    headOk && exceptions.length === 0 ? 'matched' : 'mismatch';

  return {
    status,
    mode,
    gst_period: gstPeriod.trim(),
    branch_id: branchId,
    meta: {
      gstr1_head_source: gstr1HeadSource,
      gstr3b_source: g3Source,
      voucher_map_source: 'live_gstr1_generator',
      gstr1_snapshot_branch_id: snapMeta.branch,
      gstr1_filing_status: snapMeta.filingStatus,
      gst_filing_status: gstFilingStatus,
    },
    head_wise,
    totals: {
      gstr1: tg1,
      gstr3b: tg3,
      difference: round2(tg1 - tg3),
    },
    categories,
    exceptions,
    stats: {
      total_vouchers_compared: vouchers.length,
      matched,
      mismatched,
      missing_in_ledger: missingInLedger,
      missing_in_gstr1: missingInGstr1,
      b2cs_aggregated_rows: catG1.b2cs_count,
    },
    vouchers,
    warnings: [...new Set(warnings)],
  };
}
