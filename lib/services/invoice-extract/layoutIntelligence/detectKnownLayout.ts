import { queryOne } from '@/lib/db';

import type { KnownLayoutProfileRecord } from './types';

function parseStrategy(raw: string | null | undefined): KnownLayoutProfileRecord['layoutExtractionStrategy'] {
  const s = String(raw ?? 'GENERIC').trim().toUpperCase();
  if (
    s === 'KNOWN_LAYOUT' ||
    s === 'KNOWN_VENDOR' ||
    s === 'HIGH_CONFIDENCE_LAYOUT' ||
    s === 'GENERIC'
  )
    return s as KnownLayoutProfileRecord['layoutExtractionStrategy'];
  return 'GENERIC';
}

/**
 * Loads persisted layout intelligence row for a fingerprint (null when unknown).
 */
export async function detectKnownLayout(
  layoutFingerprint: string | null | undefined,
): Promise<KnownLayoutProfileRecord | null> {
  const fp = layoutFingerprint?.trim();
  if (!fp) return null;
  try {
    const row = await queryOne<{
      layout_fingerprint: string;
      layout_extraction_strategy: string;
      common_headers: Record<string, unknown>;
      table_structures: Record<string, unknown>;
      gst_anchor_regions: Record<string, unknown>;
      totals_regions: Record<string, unknown>;
      invoice_number_anchors: Record<string, unknown>;
      hint_version: number;
      total_calibration_docs: number;
    }>(
      `SELECT layout_fingerprint, layout_extraction_strategy,
              common_headers, table_structures, gst_anchor_regions,
              totals_regions, invoice_number_anchors, hint_version, total_calibration_docs
         FROM known_layout_profiles
        WHERE layout_fingerprint = $1`,
      [fp],
    );
    if (!row) return null;
    return {
      layoutFingerprint: row.layout_fingerprint,
      layoutExtractionStrategy: parseStrategy(row.layout_extraction_strategy),
      commonHeaders: row.common_headers ?? {},
      tableStructures: row.table_structures ?? {},
      gstAnchorRegions: row.gst_anchor_regions ?? {},
      totalsRegions: row.totals_regions ?? {},
      invoiceNumberAnchors: row.invoice_number_anchors ?? {},
      hintVersion: row.hint_version ?? 1,
      totalCalibrationDocs: row.total_calibration_docs ?? 0,
    };
  } catch {
    /* table absent on fresh installs */
    return null;
  }
}
