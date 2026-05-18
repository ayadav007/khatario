/**
 * Read-side analytics over deterministic telemetry & correction logs (PostgreSQL).
 */

import { queryRows } from '@/lib/db';

export interface SupplierCorrectionCountRow {
  supplier_hash: string;
  correction_events: string;
}

export async function analyticsMostCorrectedSuppliers(
  businessId: string,
  limit = 25,
): Promise<SupplierCorrectionCountRow[]> {
  return queryRows<SupplierCorrectionCountRow>(
    `SELECT supplier_hash::text AS supplier_hash, COUNT(*)::text AS correction_events
     FROM invoice_correction_logs
     WHERE business_id = $1 AND supplier_hash IS NOT NULL
     GROUP BY supplier_hash
     ORDER BY COUNT(*) DESC
     LIMIT $2`,
    [businessId, limit]
  );
}

export async function analyticsRepairStatistics(businessId: string): Promise<{
  avg_repair_notes: number | null;
  jobs_with_repairs: string;
}> {
  const rows = await queryRows<{ avg: string | null; with_repairs: string }>(
    `SELECT
       AVG((extras->>'repair_note_count')::numeric)::text AS avg,
       COUNT(*) FILTER (
         WHERE COALESCE((extras->>'repair_note_count')::int, 0) > 0
       )::text AS with_repairs
     FROM invoice_extraction_telemetry
     WHERE business_id = $1`,
    [businessId]
  );
  const r = rows[0];
  return {
    avg_repair_notes: r?.avg != null ? Number(r.avg) : null,
    jobs_with_repairs: r?.with_repairs ?? '0',
  };
}

export async function analyticsLayoutDistribution(
  businessId: string,
  limit = 40,
): Promise<Array<{ layout_fingerprint: string; cnt: string }>> {
  return queryRows(
    `SELECT layout_fingerprint::text AS layout_fingerprint, COUNT(*)::text AS cnt
     FROM invoice_extraction_telemetry
     WHERE business_id = $1 AND layout_fingerprint IS NOT NULL
     GROUP BY layout_fingerprint
     ORDER BY COUNT(*) DESC
     LIMIT $2`,
    [businessId, limit]
  );
}

/** Sample distinct warning prefixes from telemetry JSON arrays (bounded). */
export async function analyticsCommonWarnings(businessId: string, sampleLimit = 500): Promise<string[]> {
  const rows = await queryRows<{ warnings: unknown }>(
    `SELECT warnings
     FROM invoice_extraction_telemetry
     WHERE business_id = $1
     ORDER BY extracted_at DESC
     LIMIT $2`,
    [businessId, sampleLimit]
  );
  const freq = new Map<string, number>();
  for (const row of rows) {
    const w = row.warnings;
    if (!Array.isArray(w)) continue;
    for (const entry of w) {
      const s = typeof entry === 'string' ? entry : JSON.stringify(entry);
      const key = s.slice(0, 160);
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([k]) => k);
}

/** Aggregates gst_consistency.validation_warning_count when present */
export async function analyticsGstMismatchHistogram(businessId: string): Promise<
  Array<{ bucket: string; cnt: string }>
> {
  return queryRows(
    `SELECT
       CASE
         WHEN COALESCE((gst_consistency->>'validation_warning_count')::int, 0) = 0 THEN '0'
         WHEN COALESCE((gst_consistency->>'validation_warning_count')::int, 0) <= 3 THEN '1-3'
         ELSE '4+'
       END AS bucket,
       COUNT(*)::text AS cnt
     FROM invoice_extraction_telemetry
     WHERE business_id = $1
     GROUP BY 1
     ORDER BY COUNT(*) DESC`,
    [businessId]
  );
}
