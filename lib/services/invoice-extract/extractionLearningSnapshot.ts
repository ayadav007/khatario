/**
 * Build deterministic layout fingerprints + semantic reconciliation metrics from Vision annotations.
 */

import { createHash } from 'crypto';
import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import { optimizeInvoiceInterpretation } from './invoiceOptimizationEngine';
import { parseInvoiceTableSemantics } from './invoiceTableSemanticParser';
import { parseSpatialDocument } from './ocrSpatialParser';
import type { FullTextAnnotation } from './vision-types';
import { PARSER_VERSION_METADATA } from './parserVersion';
import type { SupplierAwareResolution } from './supplierAwareExtractionEngine';
import { resolveOptimizationPriceMode } from './extractionProfileResolver';

/** @deprecated Prefer {@link getParserVersionMetadata} — kept for stable DB column defaults. */
export const EXTRACTION_PARSER_ENGINE_VERSION = PARSER_VERSION_METADATA.parserVersion;

export interface ExtractionLearningSnapshotPayload {
  layoutFingerprint: string | null;
  spatialProfile: Record<string, unknown> | null;
  semanticMetrics: Record<string, unknown> | null;
}

export function extractionLearningEnabled(): boolean {
  const v = (process.env.INVOICE_EXTRACTION_LEARNING ?? 'true').toLowerCase().trim();
  return v !== '0' && v !== 'false' && v !== 'no';
}

export function extractionSpatialLearningEnabled(): boolean {
  const v = (process.env.INVOICE_EXTRACTION_LEARNING_SPATIAL ?? 'true').toLowerCase().trim();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function fingerprintFromSpatialDocSeed(seed: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0, 40);
}

function aggregateNumericDensityBuckets(densities: number[]): {
  low: number;
  mid: number;
  high: number;
} {
  let low = 0,
    mid = 0,
    high = 0;
  for (const d of densities) {
    if (d < 0.28) low++;
    else if (d < 0.58) mid++;
    else high++;
  }
  return { low, mid, high };
}

/**
 * Spatial fingerprint from Vision only (usable before LLM). Aligns with the dense-doc branch of {@link tryBuildExtractionLearningSnapshot}.
 */
export function computeLayoutFingerprintFromAnnotation(
  annotation: FullTextAnnotation | null | undefined,
): string | null {
  if (!annotation) return null;
  try {
    const doc = parseSpatialDocument(annotation);
    if (!doc || !doc.rows.length) {
      return fingerprintFromSpatialDocSeed({
        kind: 'sparse_spatial',
        pipeline: 'annotation_only',
        textLen: annotation.text?.length ?? 0,
        pageCount: annotation.pages?.length ?? 0,
      });
    }
    return fingerprintFromSpatialDocSeed({
      pw: Math.round(doc.pageWidth),
      ph: Math.round(doc.pageHeight),
      rows: doc.rows.length,
      cols: doc.columns.length,
      regions: doc.tableRegions.length,
      mwh: Math.round(doc.debug.medianWordHeight * 100) / 100,
      align: Math.round(doc.debug.alignment.score * 1000) / 1000,
      rowAgg: Math.round(doc.debug.rowConfidenceAggregate * 1000) / 1000,
      colAgg: Math.round(doc.debug.columnConfidenceAggregate * 1000) / 1000,
      numericBuckets: aggregateNumericDensityBuckets(doc.debug.numericDensityPerColumn),
    });
  } catch {
    return null;
  }
}

function summarizeIndianExtract(extract: IndianGstInvoiceExtract): Record<string, unknown> {
  const items = extract.items ?? [];
  let positiveLines = 0;
  for (const it of items) {
    const lt = it.line_total;
    if (lt != null && Number.isFinite(lt) && lt > 0) positiveLines++;
  }
  return {
    item_row_count: items.length,
    positive_line_total_rows: positiveLines,
    gst_summary_rows: extract.gst_summary?.length ?? 0,
    price_mode: extract.price_mode ?? null,
    tax_type: extract.tax_type ?? null,
    grand_total_present: extract.grand_total != null ? 1 : 0,
    subtotal_present: extract.subtotal != null ? 1 : 0,
  };
}

function classifyRegionHistogram(regionTypes: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const t of regionTypes) {
    m[t] = (m[t] ?? 0) + 1;
  }
  return m;
}

/**
 * Privacy-preserving layout fingerprint + semantic reconciliation metrics when Vision annotation exists.
 */
export function tryBuildExtractionLearningSnapshot(params: {
  annotation: FullTextAnnotation | null | undefined;
  extract: IndianGstInvoiceExtract;
  ocrGstSummary?: {
    layout_line_count: number;
    override_count: number;
    validation_confidence: number;
    validation_warnings: number;
  };
  processingTimeMs: number;
  pipeline: string;
  supplierAware?: SupplierAwareResolution | null;
}): ExtractionLearningSnapshotPayload | undefined {
  if (!extractionLearningEnabled()) return undefined;

  const { annotation, extract, ocrGstSummary, processingTimeMs, pipeline, supplierAware } = params;

  let layoutFingerprint: string | null = null;
  let spatialProfile: Record<string, unknown> | null = null;
  let semanticMetrics: Record<string, unknown> | null = null;

  try {
    if (!annotation) {
      layoutFingerprint = fingerprintFromSpatialDocSeed({
        kind: 'no_annotation',
        pipeline,
        pages: 0,
      });
      semanticMetrics = {
        skipped_reason: 'no_full_text_annotation',
        pipeline,
        processing_time_ms: processingTimeMs,
        ...summarizeIndianExtract(extract),
        ocr_gst_summary: ocrGstSummary ?? null,
      };
      return { layoutFingerprint, spatialProfile, semanticMetrics };
    }

    const doc = parseSpatialDocument(annotation);
    if (!doc || !doc.rows.length) {
      const textLen = annotation.text?.length ?? 0;
      layoutFingerprint = fingerprintFromSpatialDocSeed({
        kind: 'sparse_spatial',
        pipeline,
        textLen,
        pageCount: annotation.pages?.length ?? 0,
      });
      semanticMetrics = {
        skipped_reason: 'spatial_parse_empty',
        pipeline,
        processing_time_ms: processingTimeMs,
        ...summarizeIndianExtract(extract),
        ocr_gst_summary: ocrGstSummary ?? null,
      };
      return { layoutFingerprint, spatialProfile, semanticMetrics };
    }

    layoutFingerprint = fingerprintFromSpatialDocSeed({
      pw: Math.round(doc.pageWidth),
      ph: Math.round(doc.pageHeight),
      rows: doc.rows.length,
      cols: doc.columns.length,
      regions: doc.tableRegions.length,
      mwh: Math.round(doc.debug.medianWordHeight * 100) / 100,
      align: Math.round(doc.debug.alignment.score * 1000) / 1000,
      rowAgg: Math.round(doc.debug.rowConfidenceAggregate * 1000) / 1000,
      colAgg: Math.round(doc.debug.columnConfidenceAggregate * 1000) / 1000,
      numericBuckets: aggregateNumericDensityBuckets(doc.debug.numericDensityPerColumn),
    });

    spatialProfile = {
      page_width: Math.round(doc.pageWidth),
      page_height: Math.round(doc.pageHeight),
      row_count: doc.rows.length,
      column_count: doc.columns.length,
      table_region_count: doc.tableRegions.length,
      median_word_height: doc.debug.medianWordHeight,
      alignment_score: doc.debug.alignment.score,
      numeric_density_buckets: aggregateNumericDensityBuckets(doc.debug.numericDensityPerColumn),
    };

    if (!extractionSpatialLearningEnabled()) {
      semanticMetrics = {
        skipped_reason: 'spatial_semantic_disabled',
        pipeline,
        processing_time_ms: processingTimeMs,
        ...summarizeIndianExtract(extract),
        ocr_gst_summary: ocrGstSummary ?? null,
      };
      return { layoutFingerprint, spatialProfile, semanticMetrics };
    }

    const semantic = parseInvoiceTableSemantics(
      doc,
      supplierAware ? { validation: supplierAware.extractionProfile.semanticValidation } : undefined,
    );
    const regionConfidenceByRegionIndex: Record<number, number> = {};
    for (const r of semantic.debug.regionClassifications ?? []) {
      regionConfidenceByRegionIndex[r.regionIndex] = r.classificationConfidence;
    }

    const priceModeForOpt = resolveOptimizationPriceMode(
      extract.price_mode,
      supplierAware?.extractionProfile.preferredPriceModeHint,
    );

    const optimized = supplierAware
      ? optimizeInvoiceInterpretation(
          {
            lineItems: semantic.lineItems,
            gstSummaries: semantic.debug.gstSummaryExtractions,
            totalsRegions: semantic.debug.totalsExtractions,
            regionConfidenceByRegionIndex,
            priceMode: priceModeForOpt,
          },
          {
            weights: supplierAware.extractionProfile.optimizationWeights,
            search: supplierAware.extractionProfile.numericRepairSearch,
          },
        )
      : optimizeInvoiceInterpretation({
          lineItems: semantic.lineItems,
          gstSummaries: semantic.debug.gstSummaryExtractions,
          totalsRegions: semantic.debug.totalsExtractions,
          regionConfidenceByRegionIndex,
          priceMode: extract.price_mode === 'exclusive' ? 'exclusive' : 'inclusive',
        });

    semanticMetrics = {
      pipeline,
      processing_time_ms: processingTimeMs,
      ...summarizeIndianExtract(extract),
      ocr_gst_summary: ocrGstSummary ?? null,
      semantic_line_items: semantic.lineItems.length,
      semantic_rejected_rows: semantic.debug.rejectedRows.length,
      semantic_merged_rows: semantic.debug.mergedRows.length,
      semantic_suspicious_rows: semantic.debug.suspiciousRows.length,
      region_classifications: classifyRegionHistogram(
        semantic.debug.regionClassifications.map((x) => x.regionType)
      ),
      suspicious_region_overlaps: semantic.debug.suspiciousRegionOverlaps.length,
      gst_summary_regions: semantic.debug.gstSummaryExtractions.length,
      totals_regions: semantic.debug.totalsExtractions.length,
      optimization_score: optimized.optimizationScore,
      baseline_optimization_score: optimized.baselineScore,
      optimization_repairs: optimized.repairedFields.length,
      optimization_warnings_count: optimized.warnings.length,
      ...(supplierAware
        ? {
            supplier_aware: {
              applied_adaptive_releases: supplierAware.appliedAdaptiveConfigs,
              ignored_adaptive_count: supplierAware.ignoredAdaptiveReleases.length,
              layout_prior_labels: supplierAware.layoutBiases.labels,
              correction_hint_buckets: supplierAware.correctionHints.slice(0, 8),
              supplier_hint_lines: supplierAware.supplierHints.length,
            },
          }
        : {}),
    };
  } catch (err: unknown) {
    console.warn('[invoice-learning] snapshot build failed:', err);
    layoutFingerprint =
      layoutFingerprint ??
      fingerprintFromSpatialDocSeed({
        kind: 'snapshot_error',
        pipeline,
        msg: String(err instanceof Error ? err.message : err).slice(0, 120),
      });
    semanticMetrics = {
      snapshot_error: true,
      pipeline,
      processing_time_ms: processingTimeMs,
      ...summarizeIndianExtract(extract),
      ocr_gst_summary: ocrGstSummary ?? null,
    };
  }

  return { layoutFingerprint, spatialProfile, semanticMetrics };
}
