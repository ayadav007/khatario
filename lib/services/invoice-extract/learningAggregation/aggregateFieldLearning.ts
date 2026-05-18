import type { PoolClient } from 'pg';

import type { InvoiceCorrectionSummary } from '../invoiceExtractionCorrectionSummary';

import { readConfidence, safeMetrics } from './aggregateLayoutProfiles';
import type { AggregationChunkStats, FieldLearningUpsertRow } from './types';

interface FieldAgg {
  correctedOccurrences: number;
  totalOccurrences: number;
  confidenceNumerator: number;
  confidenceDenom: number;
  editBuckets: Record<string, number>;
}

function ensureField(map: Map<string, FieldAgg>, field: string): FieldAgg {
  let f = map.get(field);
  if (!f) {
    f = {
      correctedOccurrences: 0,
      totalOccurrences: 0,
      confidenceNumerator: 0,
      confidenceDenom: 0,
      editBuckets: {},
    };
    map.set(field, f);
  }
  return f;
}

/**
 * Full refresh of invoice_field_learning from user_review_accept rows.
 *
 * Per field key: total_occurrences = Σ max(1, delta) across reviews where delta > 0.
 * corrected_occurrences = Σ delta. Ensures correction_rate ≤ 1 for integer deltas.
 */
export async function aggregateFieldLearning(client: PoolClient): Promise<AggregationChunkStats> {
  const started = Date.now();

  const confidenceByJob = new Map<string, number>();
  const confRes = await client.query<{ extraction_job_id: string | null; metrics: unknown }>(`
        SELECT extraction_job_id, metrics
          FROM invoice_extraction_learning_events
         WHERE event_type = 'parse_complete'
           AND extraction_job_id IS NOT NULL
         ORDER BY created_at ASC`);

  const rowsProcessedParse = confRes.rowCount ?? 0;
  for (const row of confRes.rows) {
    const jid = row.extraction_job_id!;
    if (confidenceByJob.has(jid)) continue;
    const c = readConfidence(safeMetrics(row.metrics));
    if (c != null) confidenceByJob.set(jid, c);
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

  const rowsProcessedReviews = reviewsRes.rowCount ?? 0;

  const byField = new Map<string, FieldAgg>();
  let lastUpdated: Date | null = null;

  const accumulate = (field: string, delta: number, jobId: string | null) => {
    if (delta <= 0) return;
    const d = Math.trunc(delta);
    const f = ensureField(byField, field);
    f.correctedOccurrences += d;
    f.totalOccurrences += Math.max(1, d);
    const bk = String(Math.min(512, d));
    f.editBuckets[bk] = (f.editBuckets[bk] ?? 0) + 1;
    const conf = jobId && confidenceByJob.has(jobId) ? confidenceByJob.get(jobId)! : undefined;
    if (conf != null) {
      f.confidenceNumerator += conf;
      f.confidenceDenom += 1;
    }
  };

  for (const row of reviewsRes.rows) {
    if (!lastUpdated || row.created_at > lastUpdated) lastUpdated = row.created_at;

    const raw = row.correction_summary;
    const s = (raw && typeof raw === 'object' ? raw : null) as InvoiceCorrectionSummary | null;
    if (!s) continue;

    const jobId = row.extraction_job_id;

    for (const [k, n] of Object.entries(s.item_field_changes)) {
      if (!Number.isFinite(n)) continue;
      accumulate(`item.${k}`, n as number, jobId);
    }

    accumulate('section.supplier', s.supplier_field_changes ?? 0, jobId);
    accumulate('section.invoice', s.invoice_field_changes ?? 0, jobId);
    if (s.totals_changed === true) accumulate('section.totals', 1, jobId);

    accumulate('meta.items_rows_changed', s.items_rows_changed ?? 0, jobId);
  }

  const upserts: FieldLearningUpsertRow[] = [];

  for (const [fieldName, st] of [...byField.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const total = st.totalOccurrences;
    const corrected = st.correctedOccurrences;
    const avgConf =
      st.confidenceDenom > 0 ? st.confidenceNumerator / st.confidenceDenom : null;
    let rate: number | null = null;
    if (total > 0) rate = Math.min(1, Math.max(0, corrected / total));

    const patternsEntries: Record<string, unknown> = {};
    for (const k of Object.keys(st.editBuckets).sort()) {
      patternsEntries[`delta_${k}_reviews`] = st.editBuckets[k];
    }

    upserts.push({
      fieldName,
      totalOccurrences: total,
      correctedOccurrences: corrected,
      correctionRate: rate,
      avgConfidence: avgConf,
      commonReplacementPatterns: patternsEntries,
      lastUpdatedAt: lastUpdated,
    });
  }

  await client.query('TRUNCATE invoice_field_learning');

  if (upserts.length) {
    const chunk = 200;
    for (let i = 0; i < upserts.length; i += chunk) {
      const slice = upserts.slice(i, i + chunk);
      const placeholders: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;
      for (const u of slice) {
        placeholders.push(
          `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}::jsonb, $${idx++})`,
        );
        vals.push(
          u.fieldName,
          u.totalOccurrences,
          u.correctedOccurrences,
          u.correctionRate,
          u.avgConfidence,
          JSON.stringify(u.commonReplacementPatterns),
          u.lastUpdatedAt,
        );
      }
      await client.query(
        `INSERT INTO invoice_field_learning (
           field_name,
           total_occurrences,
           corrected_occurrences,
           correction_rate,
           avg_confidence,
           common_replacement_patterns,
           last_updated_at
         ) VALUES ${placeholders.join(',')}`,
        vals,
      );
    }
  }

  const durationMs = Date.now() - started;
  return {
    name: 'aggregateFieldLearning',
    rowsProcessed: rowsProcessedParse + rowsProcessedReviews,
    rowsWritten: upserts.length,
    durationMs,
  };
}
