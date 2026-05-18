/**
 * Persist structured deterministic extraction telemetry (PostgreSQL JSONB).
 * Does not store raw OCR blobs — metrics & summaries only.
 */

import { query as dbQuery } from '@/lib/db';
import type { ExtractionLearningSnapshotPayload } from './extractionLearningSnapshot';
import { scoreInvoiceWideReconciliation } from './invoiceMathValidator';
import type { ExtractionPipelineResult } from './pipeline/extractionPipelineTypes';
import { getParserVersionMetadata } from './parserVersion';

export function extractionDetailedTelemetryEnabled(): boolean {
  const v = (process.env.INVOICE_EXTRACTION_TELEMETRY_DETAILED ?? 'true').toLowerCase().trim();
  return v !== '0' && v !== 'false' && v !== 'no';
}

export interface InvoiceTelemetryInsertRow {
  business_id: string;
  extraction_job_id: string;
  invoice_id?: string | null;
  supplier_hash: string | null;
  layout_fingerprint: string | null;
  parser_versions: Record<string, unknown>;
  optimization_score: number | null;
  subtotal_consistency: Record<string, unknown>;
  gst_consistency: Record<string, unknown>;
  warnings: unknown[];
  suspicious_rows: unknown[];
  rejected_candidates: unknown[];
  region_classifications: Record<string, unknown>;
  ocr_confidence_summary: Record<string, unknown>;
  extraction_duration_ms: number | null;
  extras: Record<string, unknown>;
}

export function buildInvoiceTelemetryInsertRow(params: {
  businessId: string;
  extractionJobId: string;
  invoiceId?: string | null;
  supplierHash: string | null;
  pipeline: ExtractionPipelineResult;
  learningSnapshot?: ExtractionLearningSnapshotPayload | null;
}): InvoiceTelemetryInsertRow {
  const { businessId, extractionJobId, invoiceId, supplierHash, pipeline, learningSnapshot } = params;
  const extract = pipeline.data;
  const wide = scoreInvoiceWideReconciliation(extract);
  const sem = (learningSnapshot?.semanticMetrics ?? {}) as Record<string, unknown>;

  const optimizationScore =
    typeof sem.optimization_score === 'number' ? sem.optimization_score : null;

  const subtotalConsistency = {
    line_sum_vs_grand_error: wide.scores.lineSumVsGrandError,
    header_composition_error: wide.scores.headerCompositionError,
    sum_line_totals: wide.scores.sumLineTotals,
    slab_taxable_sum: wide.scores.slabTaxableSum,
    invoice_wide_warnings: wide.warnings.slice(0, 40),
  };

  let gstIssuePreview: unknown[] = [];
  if (
    pipeline.debug &&
    typeof pipeline.debug === 'object' &&
    pipeline.debug !== null &&
    'ocr_gst' in pipeline.debug
  ) {
    const og = (pipeline.debug as Record<string, unknown>).ocr_gst as Record<string, unknown>;
    const val = og.validation as Record<string, unknown> | undefined;
    const issues = val?.issues;
    if (Array.isArray(issues)) gstIssuePreview = issues.slice(0, 24);
  }

  const gstConsistency = {
    validation_warning_count: pipeline.ocrGstSummary?.validation_warnings ?? null,
    validation_confidence: pipeline.ocrGstSummary?.validation_confidence ?? null,
    propagation_override_count: pipeline.ocrGstSummary?.override_count ?? null,
    gst_summary_rows_model: extract.gst_summary?.length ?? 0,
    gst_issue_preview: gstIssuePreview,
  };

  const suspiciousRows: unknown[] = [];
  if (typeof sem.semantic_suspicious_rows === 'number') {
    suspiciousRows.push({ metric: 'semantic_suspicious_rows', count: sem.semantic_suspicious_rows });
  }

  const rejectedCandidates: unknown[] = [];
  if (typeof sem.semantic_rejected_rows === 'number') {
    rejectedCandidates.push({ metric: 'semantic_rejected_rows', count: sem.semantic_rejected_rows });
  }

  const regionClassifications =
    sem.region_classifications && typeof sem.region_classifications === 'object'
      ? (sem.region_classifications as Record<string, unknown>)
      : {};

  const warningsOut = [
    ...wide.warnings,
    ...(pipeline.repairNotes ?? []).map((r) => `deterministic_repair:${r}`),
  ].slice(0, 48);

  const parser_versions: Record<string, unknown> = {
    ...getParserVersionMetadata(),
    llm_provider: pipeline.provider,
    llm_model: pipeline.model,
  };

  const extras: Record<string, unknown> = {
    repair_note_count: (pipeline.repairNotes ?? []).length,
    layout_strategy: pipeline.layoutStrategy ?? null,
    learning_semantic_skipped_reason:
      typeof sem.skipped_reason === 'string' ? sem.skipped_reason : null,
    baseline_optimization_score:
      typeof sem.baseline_optimization_score === 'number'
        ? sem.baseline_optimization_score
        : null,
    optimization_repairs:
      typeof sem.optimization_repairs === 'number' ? sem.optimization_repairs : null,
  };

  return {
    business_id: businessId,
    extraction_job_id: extractionJobId,
    invoice_id: invoiceId ?? null,
    supplier_hash: supplierHash,
    layout_fingerprint: learningSnapshot?.layoutFingerprint ?? null,
    parser_versions,
    optimization_score: optimizationScore,
    subtotal_consistency: subtotalConsistency,
    gst_consistency: gstConsistency,
    warnings: warningsOut,
    suspicious_rows: suspiciousRows,
    rejected_candidates: rejectedCandidates,
    region_classifications: regionClassifications,
    ocr_confidence_summary: {},
    extraction_duration_ms: pipeline.processingTimeMs ?? null,
    extras,
  };
}

export async function upsertInvoiceExtractionTelemetry(row: InvoiceTelemetryInsertRow): Promise<void> {
  if (!extractionDetailedTelemetryEnabled()) return;
  try {
    await dbQuery(
      `INSERT INTO invoice_extraction_telemetry (
        business_id, extraction_job_id, invoice_id, supplier_hash, layout_fingerprint,
        parser_versions, optimization_score, subtotal_consistency, gst_consistency,
        warnings, suspicious_rows, rejected_candidates, region_classifications,
        ocr_confidence_summary, extraction_duration_ms, extras
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6::jsonb,$7,$8::jsonb,$9::jsonb,
        $10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,
        $14::jsonb,$15,$16::jsonb
      )
      ON CONFLICT (extraction_job_id) DO UPDATE SET
        invoice_id = COALESCE(EXCLUDED.invoice_id, invoice_extraction_telemetry.invoice_id),
        supplier_hash = EXCLUDED.supplier_hash,
        layout_fingerprint = EXCLUDED.layout_fingerprint,
        parser_versions = EXCLUDED.parser_versions,
        optimization_score = EXCLUDED.optimization_score,
        subtotal_consistency = EXCLUDED.subtotal_consistency,
        gst_consistency = EXCLUDED.gst_consistency,
        warnings = EXCLUDED.warnings,
        suspicious_rows = EXCLUDED.suspicious_rows,
        rejected_candidates = EXCLUDED.rejected_candidates,
        region_classifications = EXCLUDED.region_classifications,
        ocr_confidence_summary = EXCLUDED.ocr_confidence_summary,
        extraction_duration_ms = EXCLUDED.extraction_duration_ms,
        extras = EXCLUDED.extras,
        extracted_at = CURRENT_TIMESTAMP`,
      [
        row.business_id,
        row.extraction_job_id,
        row.invoice_id ?? null,
        row.supplier_hash,
        row.layout_fingerprint,
        JSON.stringify(row.parser_versions),
        row.optimization_score,
        JSON.stringify(row.subtotal_consistency),
        JSON.stringify(row.gst_consistency),
        JSON.stringify(row.warnings),
        JSON.stringify(row.suspicious_rows),
        JSON.stringify(row.rejected_candidates),
        JSON.stringify(row.region_classifications),
        JSON.stringify(row.ocr_confidence_summary),
        row.extraction_duration_ms,
        JSON.stringify(row.extras),
      ]
    );
  } catch (e) {
    console.warn('[invoice-telemetry] upsert failed:', e);
  }
}

/** Convenience when callers already have normalized extract + pipeline artifacts. */
export async function recordInvoiceExtractionTelemetry(params: {
  businessId: string;
  extractionJobId: string;
  invoiceId?: string | null;
  supplierHash: string | null;
  pipeline: ExtractionPipelineResult;
  learningSnapshot?: ExtractionLearningSnapshotPayload | null;
}): Promise<void> {
  const row = buildInvoiceTelemetryInsertRow(params);
  await upsertInvoiceExtractionTelemetry(row);
}
