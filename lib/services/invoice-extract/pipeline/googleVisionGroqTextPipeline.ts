/**
 * Google Document OCR → Groq text extraction path (provider-callable).
 */

import {
  recomputeGstSummaryFromAuthoritativeLines,
  applyConsolidatedForeignTaxSplit,
} from '@/lib/indian-gst-invoice-extract';
import { VISION_PROMPT } from '@/lib/gst-invoice-vision-prompt';

import {
  preprocessInvoiceImage,
  preprocessProfileFromEnv,
} from '@/lib/services/invoice-extract/imagePreprocessingService';
import {
  inferPageHeightFromOcrLines,
  reconstructOcrLines,
} from '@/lib/services/invoice-extract/ocrLayoutService';
import {
  deriveSpatialDocumentFromAnnotation,
  invoiceConfidenceEngineEnabled,
} from '@/lib/services/invoice-extract/confidence';
import {
  invoiceLayoutIntelligenceEnabled,
  detectKnownLayout,
  buildLayoutHints,
  formatAdaptiveHintBlock,
  loadLayoutRollupBrief,
  selectExtractionStrategy,
  extractGstinHintFromOcr,
} from '@/lib/services/invoice-extract/layoutIntelligence';
import {
  computeLayoutFingerprintFromAnnotation,
  tryBuildExtractionLearningSnapshot,
  type ExtractionLearningSnapshotPayload,
} from '@/lib/services/invoice-extract/extractionLearningSnapshot';
import {
  supplierAwareExtractionEnabled,
  resolveSupplierAwareExtractionContext,
  formatSupplierAwareHintBlock,
  type SupplierAwareResolution,
} from '@/lib/services/invoice-extract/supplierAwareExtractionEngine';
import {
  applyOcrSectionGstToExtract,
  refreshTaxableValuesAfterGstPatch,
  type OcrGstPropagationDebug,
} from '@/lib/services/invoice-extract/gstPropagationEngine';
import { validateGstExtractAgainstOcr } from '@/lib/services/invoice-extract/gstValidationEngine';
import type { FullTextAnnotation } from '@/lib/services/invoice-extract/vision-types';
import { repairExtractSectionsDeterministic } from '@/lib/services/invoice-extract/repair/sectionRepairEngine';
import { pipelineFromLlmContent } from '@/lib/services/invoice-extract/pipeline/llmExtractParse';
import { reconstructItemTableFromAnnotation } from '@/lib/services/invoice-extract/ocrTableReconstructor';
import {
  extractHsnRateAnnotations,
  extractStandaloneRateAnnotation,
  formatHsnRateHintBlock,
  applyHsnRateAnnotationsToExtract,
} from '@/lib/services/invoice-extract/hsnRateAnnotationExtractor';
import type {
  ExtractionPipelineResult,
  InvoiceExtractDebugPayload,
} from '@/lib/services/invoice-extract/pipeline/extractionPipelineTypes';

const MAX_OCR_CHARS_FOR_LLM = 120_000;
const MAX_DEBUG_OCR_CHARS = 100_000;

async function googleVisionDocumentAnalyze(
  base64Image: string,
  apiKey: string,
): Promise<{ text: string; fullTextAnnotation: FullTextAnnotation | null }> {
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64Image },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          imageContext: { languageHints: ['en', 'hi'] },
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Google Vision API error (${res.status}): ${raw.slice(0, 800)}`);
  }

  let data: {
    responses?: Array<{
      fullTextAnnotation?: FullTextAnnotation;
      textAnnotations?: Array<{ description?: string }>;
      error?: { message?: string };
    }>;
  };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Google Vision returned invalid JSON');
  }

  const err0 = data.responses?.[0]?.error;
  if (err0?.message) {
    throw new Error(`Google Vision: ${err0.message}`);
  }

  const fullAnno = data.responses?.[0]?.fullTextAnnotation ?? null;
  const fullText = fullAnno?.text?.trim();
  if (fullText) {
    return { text: fullText, fullTextAnnotation: fullAnno };
  }

  const fallback = data.responses?.[0]?.textAnnotations?.[0]?.description?.trim();
  if (fallback) {
    return { text: fallback, fullTextAnnotation: null };
  }

  throw new Error('Google Vision returned no text (empty OCR). Try a clearer photo or use Groq vision.');
}

export async function runGoogleVisionGroqTextPipeline(
  file: File,
  includeDebug: boolean,
  extractionCtx?: { businessId?: string },
): Promise<ExtractionPipelineResult> {
  const googleKey = process.env.GOOGLE_VISION_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const textModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  if (!googleKey) {
    throw new Error('GOOGLE_VISION_API_KEY is not configured');
  }
  if (!groqKey) {
    throw new Error('GROQ_API_KEY is required for structured extraction after Google OCR');
  }

  const startTime = Date.now();
  const buffer = Buffer.from(await file.arrayBuffer());

  let imageBytes: Uint8Array = buffer;
  let preprocessSummary: Record<string, unknown> | undefined;
  const preprocessProfile = preprocessProfileFromEnv();
  if (preprocessProfile) {
    try {
      const pre = await preprocessInvoiceImage(buffer, {
        profile: preprocessProfile === 'auto' ? undefined : preprocessProfile,
        autoDetectProfile: preprocessProfile === 'auto',
      });
      imageBytes = pre.buffer;
      preprocessSummary = {
        profile: pre.profileId,
        width: pre.width,
        height: pre.height,
        steps: pre.stepsApplied,
        original_width: pre.originalWidth,
        original_height: pre.originalHeight,
      };
    } catch (preErr) {
      console.warn('[invoices/extract] OCR preprocess failed, using raw image:', preErr);
    }
  }

  const base64 = Buffer.from(imageBytes).toString('base64');

  const { text: ocrText, fullTextAnnotation } = await googleVisionDocumentAnalyze(base64, googleKey);
  const ocrLayoutLines = reconstructOcrLines(fullTextAnnotation);
  const clipped =
    ocrText.length > MAX_OCR_CHARS_FOR_LLM ? ocrText.slice(0, MAX_OCR_CHARS_FOR_LLM) : ocrText;

  const layoutFingerprintEarly = computeLayoutFingerprintFromAnnotation(fullTextAnnotation);
  const gstinHintEarly = extractGstinHintFromOcr(ocrText);

  const spatialDocument =
    fullTextAnnotation && (invoiceConfidenceEngineEnabled() || supplierAwareExtractionEnabled())
      ? deriveSpatialDocumentFromAnnotation(fullTextAnnotation) ?? undefined
      : undefined;

  let supplierAwareResolution: SupplierAwareResolution | undefined;
  if (supplierAwareExtractionEnabled()) {
    supplierAwareResolution = await resolveSupplierAwareExtractionContext({
      businessId: extractionCtx?.businessId ?? null,
      gstinHint: gstinHintEarly,
      layoutFingerprint: layoutFingerprintEarly,
      spatialDocument,
    });
  }

  const supplierAwareHintBlock =
    supplierAwareResolution?.supplierHints?.length &&
    supplierAwareResolution.supplierHints.length > 0
      ? formatSupplierAwareHintBlock(supplierAwareResolution.supplierHints)
      : '';

  let layoutStrategyLabel = 'GENERIC';
  let adaptiveHints = '';
  if (invoiceLayoutIntelligenceEnabled()) {
    const known = await detectKnownLayout(layoutFingerprintEarly);
    const rollup = await loadLayoutRollupBrief(layoutFingerprintEarly);
    const { strategy } = await selectExtractionStrategy({
      layoutFingerprint: layoutFingerprintEarly,
      gstinHintFromOcr: gstinHintEarly,
      knownProfile: known,
      layoutRollup: rollup,
    });
    layoutStrategyLabel = strategy;
    adaptiveHints = formatAdaptiveHintBlock(buildLayoutHints(known, strategy));
  }

  const spatialTable = reconstructItemTableFromAnnotation(fullTextAnnotation, ocrText);

  // Deterministic HSN→rate annotations extracted from OCR (e.g. "HSN 61119090, 5.0% IGST")
  const hsnAnnotations = extractHsnRateAnnotations(clipped);
  const standaloneRate = hsnAnnotations.length === 0 ? extractStandaloneRateAnnotation(clipped) : null;
  const hsnRateHintBlock = formatHsnRateHintBlock(hsnAnnotations, standaloneRate);

  const userPrompt =
    `Raw OCR from the invoice (Google Cloud Vision DOCUMENT_TEXT_DETECTION). ` +
    `Line order may be imperfect; use labels (GSTIN, Bill No, HSN, CGST, SGST, IGST, Grand Total), numbers, and Indian invoice conventions.\n\n` +
    `--- OCR START ---\n${clipped}\n--- OCR END ---\n` +
    (spatialTable
      ? `\n${spatialTable}\n\nIMPORTANT: The table above was reconstructed from spatial bounding-box data and has correct column alignment. When extracting line items, prefer the table above for Qty, Rate, Discount, Taxable, CGST, SGST, IGST, and Total values. Use the flat OCR text only for supplier/header/footer fields not present in the table.\n`
      : '\n') +
    (hsnRateHintBlock.trim() ? `\n${hsnRateHintBlock}\n` : '') +
    (adaptiveHints.trim() ? `\n${adaptiveHints}\n` : '') +
    (supplierAwareHintBlock.trim() ? `\n${supplierAwareHintBlock}\n` : '') +
    VISION_PROMPT.replace('from this invoice image', 'from the OCR text above');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: textModel,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const processingTimeMs = Date.now() - startTime;

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq text API error (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Groq text model returned no content');
  }

  let data = pipelineFromLlmContent(content);

  const repaired = repairExtractSectionsDeterministic(data);
  data = repaired.patched;

  // Deterministic HSN-rate override + marketplace column-swap repair
  const { patched: hsnPatched, notes: hsnNotes } = applyHsnRateAnnotationsToExtract(
    data,
    hsnAnnotations,
    standaloneRate,
    clipped,
  );
  data = hsnPatched;
  const allRepairNotes = [...(repaired.notes ?? []), ...hsnNotes];

  let ocrGstSummary: ExtractionPipelineResult['ocrGstSummary'] | undefined;
  let learningSnapshot: ExtractionLearningSnapshotPayload | undefined;

  let gstPropagation: OcrGstPropagationDebug | undefined;

  if (ocrLayoutLines.length > 0) {
    const pageHeight =
      fullTextAnnotation?.pages?.[0]?.height != null && fullTextAnnotation.pages[0].height > 0
        ? fullTextAnnotation.pages[0].height!
        : inferPageHeightFromOcrLines(ocrLayoutLines);
    const { extract: patched, debug: propDebug } = applyOcrSectionGstToExtract(
      data,
      ocrLayoutLines,
      pageHeight,
    );
    gstPropagation = propDebug;
    data = refreshTaxableValuesAfterGstPatch(patched);
    applyConsolidatedForeignTaxSplit(data);
    recomputeGstSummaryFromAuthoritativeLines(data);
    const val = validateGstExtractAgainstOcr(data, propDebug);
    ocrGstSummary = {
      layout_line_count: ocrLayoutLines.length,
      override_count: propDebug.overrides.length,
      validation_confidence: val.confidence,
      validation_warnings: val.issues.filter((i) => i.severity === 'warning').length,
    };

    learningSnapshot = tryBuildExtractionLearningSnapshot({
      annotation: fullTextAnnotation ?? null,
      extract: data,
      ocrGstSummary,
      processingTimeMs,
      pipeline: 'google-vision+groq-text',
      supplierAware: supplierAwareResolution,
    });

    if (includeDebug) {
      const baseDebug: InvoiceExtractDebugPayload = {
        pipeline: 'google-vision+groq-text',
        ocr_preprocess: preprocessSummary ?? null,
        layout_strategy: layoutStrategyLabel,
        layout_adaptive_hint_lines: adaptiveHints.split('\n').filter(Boolean).slice(0, 20),
        spatial_table_injected: spatialTable != null,
        deterministic_repairs: allRepairNotes,
        raw_ocr_text:
          ocrText.length > MAX_DEBUG_OCR_CHARS ? ocrText.slice(0, MAX_DEBUG_OCR_CHARS) : ocrText,
        raw_ocr_truncated: ocrText.length > MAX_DEBUG_OCR_CHARS,
        raw_ocr_full_length: ocrText.length,
        sent_to_llm_chars: clipped.length,
        ocr_was_clipped_for_llm: ocrText.length > MAX_OCR_CHARS_FOR_LLM,
        supplier_aware: supplierAwareResolution
          ? {
              applied_releases: supplierAwareResolution.appliedAdaptiveConfigs,
              ignored_adaptive: supplierAwareResolution.ignoredAdaptiveReleases.slice(0, 12),
              layout_prior_labels: supplierAwareResolution.layoutBiases.labels,
              confidence_adjustments: supplierAwareResolution.confidenceAdjustments,
              hint_lines_preview: supplierAwareResolution.supplierHints.slice(0, 16),
            }
          : undefined,
        ocr_gst: {
          propagation: propDebug,
          validation: val,
          section_headers: (propDebug.trace?.detectedHeaders ?? []).map((h) => ({
            text: h.text,
            y: ocrLayoutLines[h.lineIndex]?.y ?? 0,
            rate: h.rate,
            confidence: h.confidence,
          })),
        },
      };
      return {
        data,
        provider: 'google-vision+groq-text',
        model: `document-text-detection/${textModel}`,
        processingTimeMs,
        ocrGstSummary,
        debug: baseDebug,
        learningSnapshot,
        gstPropagation,
        spatialDocument,
        repairNotes: allRepairNotes,
        layoutStrategy: layoutStrategyLabel,
      };
    }

    return {
      data,
      provider: 'google-vision+groq-text',
      model: `document-text-detection/${textModel}`,
      processingTimeMs,
      ocrGstSummary,
      learningSnapshot,
      gstPropagation,
      spatialDocument,
      repairNotes: allRepairNotes,
      layoutStrategy: layoutStrategyLabel,
    };
  }

  learningSnapshot = tryBuildExtractionLearningSnapshot({
    annotation: fullTextAnnotation ?? null,
    extract: data,
    ocrGstSummary: undefined,
    processingTimeMs,
    pipeline: 'google-vision+groq-text',
    supplierAware: supplierAwareResolution,
  });

  const base: ExtractionPipelineResult = {
    data,
    provider: 'google-vision+groq-text',
    model: `document-text-detection/${textModel}`,
    processingTimeMs,
    learningSnapshot,
    spatialDocument,
    repairNotes: allRepairNotes,
    layoutStrategy: layoutStrategyLabel,
  };

  if (!includeDebug) return base;

  const fullLen = ocrText.length;
  const raw = fullLen > MAX_DEBUG_OCR_CHARS ? ocrText.slice(0, MAX_DEBUG_OCR_CHARS) : ocrText;
  return {
    ...base,
    debug: {
      pipeline: 'google-vision+groq-text',
      layout_strategy: layoutStrategyLabel,
      layout_adaptive_hint_lines: adaptiveHints.split('\n').filter(Boolean).slice(0, 20),
      deterministic_repairs: allRepairNotes,
      raw_ocr_text: raw,
      raw_ocr_truncated: fullLen > MAX_DEBUG_OCR_CHARS,
      raw_ocr_full_length: fullLen,
      sent_to_llm_chars: clipped.length,
      ocr_was_clipped_for_llm: ocrText.length > MAX_OCR_CHARS_FOR_LLM,
      supplier_aware: supplierAwareResolution
        ? {
            applied_releases: supplierAwareResolution.appliedAdaptiveConfigs,
            ignored_adaptive: supplierAwareResolution.ignoredAdaptiveReleases.slice(0, 12),
            layout_prior_labels: supplierAwareResolution.layoutBiases.labels,
            confidence_adjustments: supplierAwareResolution.confidenceAdjustments,
            hint_lines_preview: supplierAwareResolution.supplierHints.slice(0, 16),
          }
        : undefined,
    },
  };
}
