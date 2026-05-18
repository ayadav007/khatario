import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';

import type { ExtractionLearningSnapshotPayload } from '@/lib/services/invoice-extract/extractionLearningSnapshot';
import type { InvoiceSpatialDocument } from '@/lib/services/invoice-extract/ocrSpatialParser';
import type { OcrGstPropagationDebug } from '@/lib/services/invoice-extract/gstPropagationEngine';

/** When INVOICE_EXTRACT_DEBUG=true, returned on the extract API (not stored on extraction_jobs row). */
export type InvoiceExtractDebugPayload = Record<string, unknown>;

export type ExtractionPipelineResult = {
  data: IndianGstInvoiceExtract;
  provider: string;
  model: string;
  processingTimeMs: number;
  debug?: InvoiceExtractDebugPayload;
  gstPropagation?: OcrGstPropagationDebug;
  spatialDocument?: InvoiceSpatialDocument;
  ocrGstSummary?: {
    layout_line_count: number;
    override_count: number;
    validation_confidence: number;
    validation_warnings: number;
  };
  learningSnapshot?: ExtractionLearningSnapshotPayload;
  /** Deterministic post-parse repair notes */
  repairNotes?: string[];
  /** Phase 3 layout routing (debug only by default). */
  layoutStrategy?: string;
};
