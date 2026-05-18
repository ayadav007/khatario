import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import type { ExtractionLearningSnapshotPayload } from '@/lib/services/invoice-extract/extractionLearningSnapshot';
import type { GstSectionMarker } from '@/lib/services/invoice-extract/gstSectionParser';
import type { InvoiceOptimizationResult } from '@/lib/services/invoice-extract/invoiceOptimizationTypes';
import type { InvoiceSpatialDocument } from '@/lib/services/invoice-extract/ocrSpatialParser';
import type { InvoiceExtractDebugPayload } from '@/lib/services/invoice-extract/pipeline/extractionPipelineTypes';
import type { SemanticInvoiceTableParseResult } from '@/lib/services/invoice-extract/semanticInvoiceTypes';
import type { OcrGstPropagationDebug } from '@/lib/services/invoice-extract/gstPropagationEngine';

export type InvoiceExtractionDebugViewerProps = {
  /** URL or data URL of the invoice image (same pixel space as Vision / spatial doc when possible). */
  imageSrc: string;
  imageAlt?: string;
  spatialDocument?: InvoiceSpatialDocument | null;
  semanticParse?: SemanticInvoiceTableParseResult | null;
  optimization?: InvoiceOptimizationResult | null;
  gstPropagation?: OcrGstPropagationDebug | null;
  gstSectionMarkers?: GstSectionMarker[];
  debugPayload?: InvoiceExtractDebugPayload | null;
  learningSnapshot?: ExtractionLearningSnapshotPayload | null;
  telemetrySummary?: Record<string, unknown> | null;
  /** Included in JSON export for full context. */
  indianExtract?: IndianGstInvoiceExtract | null;
  className?: string;
};

export type OverlayToggles = {
  ocrWords: boolean;
  rows: boolean;
  columns: boolean;
  tableRegions: boolean;
  gstRegions: boolean;
  totalsRegions: boolean;
  suspiciousRows: boolean;
  repairedFields: boolean;
  rejectedRepairs: boolean;
  semanticLinks: boolean;
};

export const DEFAULT_OVERLAY_TOGGLES: OverlayToggles = {
  ocrWords: true,
  rows: true,
  columns: true,
  tableRegions: true,
  gstRegions: true,
  totalsRegions: true,
  suspiciousRows: true,
  repairedFields: true,
  rejectedRepairs: true,
  semanticLinks: true,
};
