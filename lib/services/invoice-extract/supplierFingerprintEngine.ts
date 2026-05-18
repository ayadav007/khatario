/**
 * Deterministic supplier / layout fingerprints from OCR-derived geometry + canonical extract.
 * No ML — stable hashing over normalized structural signals.
 */

import { createHash } from 'crypto';
import { GSTIN_RE, type IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';

export type DominantLayoutType = 'thermal_narrow' | 'standard_document' | 'wide_table' | 'unknown';

export interface SupplierFingerprintDigest {
  supplierHash: string | null;
  dominantLayoutType: DominantLayoutType;
  columnPatterns: {
    column_count_bucket: string;
    table_region_bucket: string;
  };
  commonHeaders: string[];
  gstPatterns: {
    tax_type: string | null;
    gst_rates_sorted: number[];
    gst_summary_rows: number;
  };
  compositeFingerprint: string;
}

function bucketCols(n: number): string {
  if (n <= 0) return 'c0';
  if (n <= 4) return `c${n}`;
  if (n <= 8) return 'c5_8';
  return 'c9plus';
}

function bucketRegions(n: number): string {
  if (n <= 0) return 'r0';
  if (n === 1) return 'r1';
  if (n <= 3) return 'r2_3';
  return 'r4plus';
}

/** Privacy-preserving supplier key — GSTIN-only hash when valid. */
export function supplierHashFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || typeof gstin !== 'string') return null;
  const g = gstin.replace(/\s/g, '').toUpperCase();
  if (!GSTIN_RE.test(g)) return null;
  return createHash('sha256').update(`gstin:${g}`).digest('hex').slice(0, 32);
}

export function inferDominantLayoutType(pageWidthPx: number | null | undefined): DominantLayoutType {
  if (pageWidthPx == null || !Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return 'unknown';
  if (pageWidthPx < 520) return 'thermal_narrow';
  if (pageWidthPx < 1400) return 'standard_document';
  return 'wide_table';
}

function stableSortedRates(extract: IndianGstInvoiceExtract): number[] {
  const rates = new Set<number>();
  for (const row of extract.gst_summary ?? []) {
    if (Number.isFinite(row.gst_rate)) rates.add(Math.round(row.gst_rate * 1000) / 1000);
  }
  for (const it of extract.items ?? []) {
    const r = it.gst_rate;
    if (r != null && Number.isFinite(r)) rates.add(Math.round(r * 1000) / 1000);
  }
  return [...rates].sort((a, b) => a - b);
}

function headerTokensFromExtract(extract: IndianGstInvoiceExtract): string[] {
  const tokens: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    const t = s.trim().toUpperCase().slice(0, 40);
    if (t.length) tokens.push(t);
  };
  push(extract.supplier_name);
  push(extract.invoice_number);
  push(extract.place_of_supply);
  return tokens.slice(0, 12);
}

/**
 * Build structural fingerprint digest used for clustering & telemetry (deterministic).
 */
export function buildSupplierLayoutFingerprint(params: {
  extract: IndianGstInvoiceExtract;
  pageWidthPx?: number | null;
  spatialProfile?: Record<string, unknown> | null;
}): SupplierFingerprintDigest {
  const { extract, spatialProfile } = params;
  const pageW =
    params.pageWidthPx ??
    (typeof spatialProfile?.page_width === 'number' ? spatialProfile.page_width : null);

  const colCount =
    typeof spatialProfile?.column_count === 'number' ? spatialProfile.column_count : 0;

  const regionCount =
    typeof spatialProfile?.table_region_count === 'number' ? spatialProfile.table_region_count : 0;

  const gstRates = stableSortedRates(extract);

  const compositeSeed = {
    supplier_hash: supplierHashFromGstin(extract.supplier_gstin),
    layout: inferDominantLayoutType(pageW),
    cols: bucketCols(colCount),
    regions: bucketRegions(regionCount),
    tax_type: extract.tax_type ?? 'unknown',
    gst_rates: gstRates,
    price_mode: extract.price_mode ?? null,
    item_rows: extract.items?.length ?? 0,
  };

  const compositeFingerprint = createHash('sha256')
    .update(JSON.stringify(compositeSeed))
    .digest('hex')
    .slice(0, 40);

  return {
    supplierHash: supplierHashFromGstin(extract.supplier_gstin),
    dominantLayoutType: inferDominantLayoutType(pageW),
    columnPatterns: {
      column_count_bucket: bucketCols(colCount),
      table_region_bucket: bucketRegions(regionCount),
    },
    commonHeaders: headerTokensFromExtract(extract),
    gstPatterns: {
      tax_type: extract.tax_type ?? null,
      gst_rates_sorted: gstRates,
      gst_summary_rows: extract.gst_summary?.length ?? 0,
    },
    compositeFingerprint,
  };
}
