import type { PoolClient } from 'pg';

import type { InvoiceCorrectionSummary } from '../invoiceExtractionCorrectionSummary';

import type { AggregationChunkStats, LayoutProfileUpsertRow, ParseTelemetryRow } from './types';

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

export function safeMetrics(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  return raw as Record<string, unknown>;
}

export function readProcessingMs(
  metrics: Record<string, unknown>,
  jobFallback: number | null | undefined,
): number | null {
  return num(metrics.processing_time_ms) ?? jobFallback ?? null;
}

export function readConfidence(metrics: Record<string, unknown>): number | null {
  const ocr = metrics.ocr_gst_summary;
  if (!ocr || typeof ocr !== 'object') return null;
  return num((ocr as Record<string, unknown>).validation_confidence);
}

export function stableJsonObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    const v = obj[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stableJsonObject(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function mean(vals: number[]): number | null {
  if (!vals.length) return null;
  let s = 0;
  for (const v of vals) s += v;
  return s / vals.length;
}

function popStdSample(vals: number[]): number | null {
  if (vals.length < 2) return null;
  const m = mean(vals);
  if (m === null) return null;
  let sse = 0;
  for (const v of vals) {
    const d = v - m;
    sse += d * d;
  }
  return Math.sqrt(sse / vals.length);
}

interface LayoutAggState {
  jobIds: Set<string>;
  processingMs: number[];
  confidence: number[];
  columnCounts: number[];
  parseRowCount: number;
  lastSeenAt: Date | null;
}

function bumpFieldCounts(dst: Record<string, number>, src: Record<string, number>) {
  for (const [k, n] of Object.entries(src)) {
    if (!Number.isFinite(n)) continue;
    dst[k] = (dst[k] ?? 0) + Math.trunc(n);
  }
}

/**
 * Deterministic full rebuild of invoice_layout_profiles from telemetry.
 */
export async function aggregateLayoutProfiles(client: PoolClient): Promise<AggregationChunkStats> {
  const started = Date.now();

  const parseRes = await client.query<ParseTelemetryRow>(`
    SELECT e.extraction_job_id,
           e.layout_fingerprint,
           e.metrics,
           e.spatial_profile::json AS spatial_profile,
           e.created_at AT TIME ZONE 'UTC' AS created_at,
           j.processing_time_ms AS job_processing_time_ms
      FROM invoice_extraction_learning_events e
      LEFT JOIN invoice_extraction_jobs j ON j.id = e.extraction_job_id
     WHERE e.event_type = 'parse_complete'
       AND e.layout_fingerprint IS NOT NULL
     ORDER BY e.created_at ASC`);

  const rowsProcessed = parseRes.rowCount ?? 0;

  const byFingerprint = new Map<string, LayoutAggState>();
  const jobToFingerprintFirst = new Map<string, string>();

  for (const row of parseRes.rows) {
    const fp = row.layout_fingerprint!;
    const jobId = row.extraction_job_id;
    const metrics = safeMetrics(row.metrics);
    const spatial = row.spatial_profile ? safeMetrics(row.spatial_profile) : null;

    let st = byFingerprint.get(fp);
    if (!st) {
      st = {
        jobIds: new Set(),
        processingMs: [],
        confidence: [],
        columnCounts: [],
        parseRowCount: 0,
        lastSeenAt: null,
      };
      byFingerprint.set(fp, st);
    }

    st.parseRowCount += 1;
    if (!st.lastSeenAt || row.created_at > st.lastSeenAt) st.lastSeenAt = row.created_at;

    if (jobId) {
      st.jobIds.add(jobId);
      if (!jobToFingerprintFirst.has(jobId)) jobToFingerprintFirst.set(jobId, fp);
    }

    const pms = readProcessingMs(metrics, row.job_processing_time_ms);
    if (pms != null) st.processingMs.push(pms);

    const conf = readConfidence(metrics);
    if (conf != null) st.confidence.push(conf);

    const col = num(spatial?.column_count);
    if (col != null) st.columnCounts.push(col);
  }

  const reviewsRes = await client.query<{
    extraction_job_id: string | null;
    correction_summary: unknown;
    created_at: Date;
  }>(`
    SELECT extraction_job_id, correction_summary::json, created_at AT TIME ZONE 'UTC'
      FROM invoice_extraction_learning_events
     WHERE event_type = 'user_review_accept'
       AND extraction_job_id IS NOT NULL
     ORDER BY created_at ASC`);

  interface ReviewAgg {
    accepted: number;
    total: number;
    errorFieldCounts: Record<string, number>;
  }

  const reviewByFp = new Map<string, ReviewAgg>();

  for (const row of reviewsRes.rows) {
    const jobId = row.extraction_job_id;
    const fp = jobId ? jobToFingerprintFirst.get(jobId) : undefined;
    if (!fp) continue;

    let ra = reviewByFp.get(fp);
    if (!ra) {
      ra = { accepted: 0, total: 0, errorFieldCounts: {} };
      reviewByFp.set(fp, ra);
    }

    const raw = row.correction_summary;
    const summary = (raw && typeof raw === 'object' ? raw : null) as InvoiceCorrectionSummary | null;
    if (!summary) continue;

    ra.total += 1;
    if (summary.accept_kind === 'clean') ra.accepted += 1;

    bumpFieldCounts(ra.errorFieldCounts, summary.item_field_changes);
    if ((summary.supplier_field_changes ?? 0) > 0) {
      ra.errorFieldCounts['section:supplier'] =
        (ra.errorFieldCounts['section:supplier'] ?? 0) + (summary.supplier_field_changes ?? 0);
    }
    if ((summary.invoice_field_changes ?? 0) > 0) {
      ra.errorFieldCounts['section:invoice'] =
        (ra.errorFieldCounts['section:invoice'] ?? 0) + (summary.invoice_field_changes ?? 0);
    }
    if ((summary.totals_changed ?? false) === true) {
      ra.errorFieldCounts['section:totals'] = (ra.errorFieldCounts['section:totals'] ?? 0) + 1;
    }
    if ((summary.items_rows_changed ?? 0) > 0) {
      ra.errorFieldCounts['meta:items_rows_changed'] =
        (ra.errorFieldCounts['meta:items_rows_changed'] ?? 0) + (summary.items_rows_changed ?? 0);
    }
  }

  const upserts: LayoutProfileUpsertRow[] = [];

  for (const [fp, st] of [...byFingerprint.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rv = reviewByFp.get(fp);
    const totalReviews = rv?.total ?? 0;
    const accepted = rv?.accepted ?? 0;

    const acceptanceRate = totalReviews > 0 ? clamp01(accepted / totalReviews) : null;
    const correctionRate =
      totalReviews > 0 ? clamp01(1 - accepted / totalReviews) : null;

    let layoutStability: number | null = null;
    let columnCv: number | null = null;
    if (st.columnCounts.length >= 2) {
      const m = mean(st.columnCounts)!;
      const sd = popStdSample(st.columnCounts);
      if (sd != null && m > 1e-6) {
        columnCv = sd / m;
        layoutStability = clamp01(1 - columnCv);
      }
    }

    const commonPayload: Record<string, unknown> = stableJsonObject({
      field_edit_counts: rv ? stableJsonObject(rv.errorFieldCounts as Record<string, unknown>) : {},
      layout_signals: {
        stability_score: layoutStability,
        column_count_cv: columnCv,
        column_count_samples: st.columnCounts.length,
        distinct_parse_events: st.parseRowCount,
      },
    });

    upserts.push({
      layoutFingerprint: fp,
      totalDocuments: st.jobIds.size || st.parseRowCount,
      acceptedDocuments: accepted,
      acceptanceRate,
      avgProcessingMs: mean(st.processingMs),
      avgConfidence: mean(st.confidence),
      correctionRate,
      commonErrorFields: commonPayload,
      lastSeenAt: st.lastSeenAt,
    });
  }

  await client.query('TRUNCATE invoice_layout_profiles');

  if (upserts.length) {
    const chunk = 200;
    for (let i = 0; i < upserts.length; i += chunk) {
      const slice = upserts.slice(i, i + chunk);
      const placeholders: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;
      for (const u of slice) {
        placeholders.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}::jsonb, $${idx++})`,
        );
        vals.push(
          u.layoutFingerprint,
          u.totalDocuments,
          u.acceptedDocuments,
          u.acceptanceRate,
          u.avgProcessingMs,
          u.avgConfidence,
          u.correctionRate,
          JSON.stringify(u.commonErrorFields),
          u.lastSeenAt,
        );
      }
      await client.query(
        `INSERT INTO invoice_layout_profiles (
           layout_fingerprint,
           total_documents,
           accepted_documents,
           acceptance_rate,
           avg_processing_ms,
           avg_confidence,
           correction_rate,
           common_error_fields,
           last_seen_at
         ) VALUES ${placeholders.join(',')}`,
        vals,
      );
    }
  }

  const durationMs = Date.now() - started;
  return {
    name: 'aggregateLayoutProfiles',
    rowsProcessed,
    rowsWritten: upserts.length,
    durationMs,
  };
}
