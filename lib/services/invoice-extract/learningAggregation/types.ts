import type { InvoiceCorrectionSummary } from '../invoiceExtractionCorrectionSummary';

export interface ParseTelemetryRow {
  extraction_job_id: string | null;
  layout_fingerprint: string | null;
  metrics: Record<string, unknown>;
  spatial_profile: Record<string, unknown> | null;
  created_at: Date;
  job_processing_time_ms: number | null;
}

export interface ReviewTelemetryRow {
  extraction_job_id: string | null;
  correction_summary: InvoiceCorrectionSummary | null;
  created_at: Date;
}

export interface JobExtractionRow {
  id: string;
  extraction_data: Record<string, unknown> | null;
}

export interface LayoutProfileUpsertRow {
  layoutFingerprint: string;
  totalDocuments: number;
  acceptedDocuments: number;
  acceptanceRate: number | null;
  avgProcessingMs: number | null;
  avgConfidence: number | null;
  correctionRate: number | null;
  commonErrorFields: Record<string, unknown>;
  lastSeenAt: Date | null;
}

export interface VendorProfileUpsertRow {
  vendorKey: string;
  vendorNameHash: string;
  gstinHash: string | null;
  knownLayoutFingerprints: string[];
  avgConfidence: number | null;
  avgCorrectionRate: number | null;
  preferredColumnPatterns: Record<string, unknown>;
  commonHeaders: Record<string, unknown>;
  totalDocuments: number;
  lastSeenAt: Date | null;
}

export interface FieldLearningUpsertRow {
  fieldName: string;
  totalOccurrences: number;
  correctedOccurrences: number;
  correctionRate: number | null;
  avgConfidence: number | null;
  commonReplacementPatterns: Record<string, unknown>;
  lastUpdatedAt: Date | null;
}

export interface AggregationChunkStats {
  name: string;
  rowsProcessed: number;
  rowsWritten: number;
  durationMs: number;
}

export interface InvoiceLearningAggregationSummary {
  enabled: boolean;
  chunks: AggregationChunkStats[];
  totalRowsProcessed: number;
  totalRowsWritten: number;
  durationMs: number;
}
