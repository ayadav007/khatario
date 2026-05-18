import type { PoolClient } from 'pg';

import type { InvoiceCorrectionSummary } from '../invoiceExtractionCorrectionSummary';

import { stableJsonObject, readConfidence, safeMetrics } from './aggregateLayoutProfiles';
import { vendorIdentityFromSupplierJson } from './hashes';
import type { AggregationChunkStats, VendorProfileUpsertRow } from './types';

function mergeRegionSignals(dst: Record<string, unknown>, metrics: Record<string, unknown>) {
  const regions = metrics.region_classifications;
  if (!regions || typeof regions !== 'object') return;
  const r = regions as Record<string, unknown>;
  for (const key of [...Object.keys(r)].sort()) {
    const n = Number(r[key]);
    if (!Number.isFinite(n)) continue;
    const cur = typeof dst[`region.${key}`] === 'number' ? (dst[`region.${key}`] as number) : 0;
    dst[`region.${key}`] = cur + n;
  }
}

function histogramBucket(bucket: Record<string, number>, value: number) {
  const k = String(Math.trunc(value));
  bucket[k] = (bucket[k] ?? 0) + 1;
}

/** Deterministic full rebuild of invoice_vendor_profiles. */
export async function aggregateVendorProfiles(client: PoolClient): Promise<AggregationChunkStats> {
  const started = Date.now();

  const parseRes = await client.query<{
    extraction_job_id: string | null;
    layout_fingerprint: string | null;
    metrics: unknown;
    spatial_profile: unknown;
    created_at: Date;
    job_processing_time_ms: number | null;
    extraction_data: unknown;
  }>(`
    SELECT e.extraction_job_id,
           e.layout_fingerprint,
           e.metrics,
           e.spatial_profile::json,
           e.created_at AT TIME ZONE 'UTC' AS created_at,
           j.processing_time_ms AS job_processing_time_ms,
           j.extraction_data::json
      FROM invoice_extraction_learning_events e
 INNER JOIN invoice_extraction_jobs j ON j.id = e.extraction_job_id
     WHERE e.event_type = 'parse_complete'
       AND e.layout_fingerprint IS NOT NULL
     ORDER BY e.created_at ASC`);

  interface VendorAggState {
    vendorNameHash: string;
    gstinHash: string | null;
    jobIds: Set<string>;
    fingerprints: Set<string>;
    confidence: number[];
    columnHist: Record<string, number>;
    regionSignals: Record<string, unknown>;
    lastSeen: Date | null;
  }

  const byVendor = new Map<string, VendorAggState>();
  const rowsProcessed = parseRes.rowCount ?? 0;

  for (const row of parseRes.rows) {
    const jobId = row.extraction_job_id;
    if (!jobId) continue;

    const data = safeMetrics(row.extraction_data);
    const supplierRaw = data.supplier;
    const { vendorKey, vendorNameHash, gstinHash } = vendorIdentityFromSupplierJson(supplierRaw);

    let st = byVendor.get(vendorKey);
    if (!st) {
      st = {
        vendorNameHash,
        gstinHash,
        jobIds: new Set(),
        fingerprints: new Set(),
        confidence: [],
        columnHist: {},
        regionSignals: {},
        lastSeen: null,
      };
      byVendor.set(vendorKey, st);
    }

    st.jobIds.add(jobId);
    st.fingerprints.add(row.layout_fingerprint!);

    if (!st.lastSeen || row.created_at > st.lastSeen) st.lastSeen = row.created_at;

    const metrics = safeMetrics(row.metrics);
    const conf = readConfidence(metrics);
    if (conf != null) st.confidence.push(conf);

    const spatial = safeMetrics(row.spatial_profile);
    const cols = spatial.column_count;
    if (typeof cols === 'number' && Number.isFinite(cols)) histogramBucket(st.columnHist, cols);

    mergeRegionSignals(st.regionSignals, metrics);
  }

  const reviewsRes = await client.query<{
    extraction_job_id: string | null;
    correction_summary: unknown;
    created_at: Date;
  }>(`
    SELECT e.extraction_job_id, e.correction_summary::json, e.created_at AT TIME ZONE 'UTC'
      FROM invoice_extraction_learning_events e
     WHERE e.event_type = 'user_review_accept'
       AND e.extraction_job_id IS NOT NULL
     ORDER BY e.created_at ASC`);

  /** Map extraction_job -> vendor_key from earliest parse_complete join */
  const jobVendorKey = new Map<string, string>();
  for (const row of parseRes.rows) {
    const jobId = row.extraction_job_id;
    if (!jobId || jobVendorKey.has(jobId)) continue;
    const data = safeMetrics(row.extraction_data);
    const supplierRaw = data.supplier;
    const { vendorKey } = vendorIdentityFromSupplierJson(supplierRaw);
    jobVendorKey.set(jobId, vendorKey);
  }

  const corrByVendor = new Map<
    string,
    {
      sum: number;
      n: number;
    }
  >();

  for (const row of reviewsRes.rows) {
    const jobId = row.extraction_job_id;
    if (!jobId) continue;
    const vk = jobVendorKey.get(jobId);
    if (!vk) continue;
    const raw = row.correction_summary;
    const summary = (raw && typeof raw === 'object' ? raw : null) as InvoiceCorrectionSummary | null;
    if (!summary) continue;

    const edited = summary.accept_kind === 'edited' ? 1 : 0;
    let c = corrByVendor.get(vk);
    if (!c) {
      c = { sum: 0, n: 0 };
      corrByVendor.set(vk, c);
    }
    c.sum += edited;
    c.n += 1;
  }

  const upserts: VendorProfileUpsertRow[] = [];

  for (const [vendorKey, st] of [...byVendor.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const fingerprints = [...st.fingerprints].sort();

    const vendorNameHash = st.vendorNameHash;
    const gstinHash = st.gstinHash;

    const corr = corrByVendor.get(vendorKey);
    const avgCorrectionRate =
      corr && corr.n > 0 ? Math.min(1, Math.max(0, corr.sum / corr.n)) : null;

    let confMean: number | null = null;
    if (st.confidence.length) {
      let s = 0;
      for (const x of st.confidence) s += x;
      confMean = s / st.confidence.length;
    }

    const colHistStable: Record<string, unknown> = {};
    for (const k of Object.keys(st.columnHist).sort()) {
      colHistStable[k] = st.columnHist[k]!;
    }
    const preferredPatterns = stableJsonObject({
      spatial_column_histogram: stableJsonObject(colHistStable),
      region_classification_counts: stableJsonObject(st.regionSignals),
    });

    upserts.push({
      vendorKey,
      vendorNameHash,
      gstinHash,
      knownLayoutFingerprints: fingerprints,
      avgConfidence: confMean,
      avgCorrectionRate,
      preferredColumnPatterns: preferredPatterns,
      commonHeaders: {},
      totalDocuments: st.jobIds.size,
      lastSeenAt: st.lastSeen,
    });
  }

  await client.query('TRUNCATE invoice_vendor_profiles');

  if (upserts.length) {
    const chunk = 100;
    for (let i = 0; i < upserts.length; i += chunk) {
      const slice = upserts.slice(i, i + chunk);
      const placeholders: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;
      for (const u of slice) {
        placeholders.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}::text[], $${idx++}, $${idx++}, $${idx++}::jsonb, $${idx++}::jsonb, $${idx++}, $${idx++})`,
        );
        vals.push(
          u.vendorKey,
          u.vendorNameHash,
          u.gstinHash,
          u.knownLayoutFingerprints,
          u.avgConfidence,
          u.avgCorrectionRate,
          JSON.stringify(u.preferredColumnPatterns),
          JSON.stringify(u.commonHeaders),
          u.totalDocuments,
          u.lastSeenAt,
        );
      }
      await client.query(
        `INSERT INTO invoice_vendor_profiles (
           vendor_key,
           vendor_name_hash,
           gstin_hash,
           known_layout_fingerprints,
           avg_confidence,
           avg_correction_rate,
           preferred_column_patterns,
           common_headers,
           total_documents,
           last_seen_at
         ) VALUES ${placeholders.join(',')}`,
        vals,
      );
    }
  }

  const durationMs = Date.now() - started;
  return {
    name: 'aggregateVendorProfiles',
    rowsProcessed,
    rowsWritten: upserts.length,
    durationMs,
  };
}
