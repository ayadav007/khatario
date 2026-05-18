/**
 * Persist invoice extraction learning rows (Postgres).
 */

import { query as dbQuery } from '@/lib/db';
import type { ExtractionLearningSnapshotPayload } from './extractionLearningSnapshot';
import {
  EXTRACTION_PARSER_ENGINE_VERSION,
  extractionLearningEnabled,
} from './extractionLearningSnapshot';

export type ExtractionLearningEventType = 'parse_complete' | 'user_review_accept';

export interface ExtractionLearningInsertPayload extends ExtractionLearningSnapshotPayload {
  metrics: Record<string, unknown>;
}

export function mergeLearningInsertPayload(
  snapshot: ExtractionLearningSnapshotPayload | undefined,
  extraMetrics: Record<string, unknown>
): ExtractionLearningInsertPayload | null {
  if (!extractionLearningEnabled()) return null;
  if (!snapshot) {
    return {
      layoutFingerprint: null,
      spatialProfile: null,
      semanticMetrics: null,
      metrics: extraMetrics,
    };
  }
  return {
    ...snapshot,
    metrics: {
      ...extraMetrics,
      ...(snapshot.semanticMetrics ?? {}),
    },
  };
}

export async function insertInvoiceLearningEvent(row: {
  businessId: string;
  userId: string | null;
  extractionJobId: string | null;
  eventType: ExtractionLearningEventType;
  payload: ExtractionLearningInsertPayload | null;
  correctionSummary?: Record<string, unknown> | null;
}): Promise<void> {
  if (!extractionLearningEnabled() || !row.payload) return;

  try {
    await dbQuery(
      `INSERT INTO invoice_extraction_learning_events (
        business_id, user_id, extraction_job_id, event_type,
        layout_fingerprint, spatial_profile, metrics, correction_summary,
        parser_engine_version
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,
      [
        row.businessId,
        row.userId,
        row.extractionJobId,
        row.eventType,
        row.payload.layoutFingerprint,
        JSON.stringify(row.payload.spatialProfile ?? {}),
        JSON.stringify(row.payload.metrics ?? {}),
        row.correctionSummary != null ? JSON.stringify(row.correctionSummary) : null,
        EXTRACTION_PARSER_ENGINE_VERSION,
      ]
    );
  } catch (e) {
    console.warn('[invoice-learning] insert failed:', e);
  }
}
