/**
 * Gemini Vision extraction pipeline.
 *
 * Sends the invoice image directly to Gemini as a native vision call, trying each
 * model in GEMINI_MODELS (or GEMINI_MODEL) until one answers.
 * No OCR step, no spatial reconstruction, no section-header propagation engine —
 * the model sees the image and applies the prompt rules visually.
 *
 * Post-LLM: lightweight deterministic repairs + GST summary recompute.
 */

import {
  recomputeGstSummaryFromAuthoritativeLines,
  applyConsolidatedForeignTaxSplit,
  normalizeIndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import { VISION_PROMPT } from '@/lib/gst-invoice-vision-prompt';
import { buildGeminiVisionGenerateContentBody } from '@/lib/invoice-extract/latency/gemini-generation-config';
import { prepareInvoiceVisionImageServer } from '@/lib/invoice-extract/latency/prepare-vision-image-server';
import { repairExtractSectionsDeterministic } from '@/lib/services/invoice-extract/repair/sectionRepairEngine';
import { pipelineFromLlmContent } from '@/lib/services/invoice-extract/pipeline/llmExtractParse';
import type { ExtractionPipelineResult } from '@/lib/services/invoice-extract/pipeline/extractionPipelineTypes';
import {
  buildInvoiceGeminiMetricsLine,
  logInvoiceGeminiMetrics,
  parseGeminiUsageMetadata,
} from '@/lib/invoice-extract/latency/gemini-metrics-diagnostic';
import {
  ProviderHttpError,
  geminiVisionModels,
  runWithModelFallback,
} from '@/lib/services/invoice-extract/pipeline/visionModelFallback';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 90_000;

export async function runGeminiVisionPipeline(
  file: File,
  includeDebug: boolean,
  _extractionCtx?: { businessId?: string },
): Promise<ExtractionPipelineResult> {
  const pipelineStartedAt = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const fallbackMime = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';

  let prepared: Awaited<ReturnType<typeof prepareInvoiceVisionImageServer>>;
  try {
    prepared = await prepareInvoiceVisionImageServer(rawBuffer, fallbackMime);
  } catch {
    prepared = {
      buffer: rawBuffer,
      mimeType: fallbackMime,
      width: 0,
      height: 0,
      originalWidth: 0,
      originalHeight: 0,
      resized: false,
      reencoded: false,
      oriented: false,
    };
  }

  const base64 = prepared.buffer.toString('base64');

  const beforeFetchMs = Date.now() - pipelineStartedAt;

  const { res, model, processingTimeMs } = await runWithModelFallback('gemini', geminiVisionModels(), async (model) => {
    const startTime = Date.now();
    // Key in a header, not the URL, so it never shows up in error or proxy logs.
    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(
        buildGeminiVisionGenerateContentBody({
          prompt: VISION_PROMPT,
          mimeType: prepared.mimeType,
          base64,
          model,
        }),
      ),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new ProviderHttpError('gemini', model, res.status, await res.text());
    }
    return { res, model, processingTimeMs: Date.now() - startTime };
  });

  const bodyReadStartedAt = Date.now();
  const json = await res.json();
  const bodyReadMs = Date.now() - bodyReadStartedAt;
  const usage = parseGeminiUsageMetadata(json);

  // Gemini response shape: candidates[0].content.parts[0].text
  const candidate = json?.candidates?.[0];
  const content: unknown = candidate?.content?.parts?.[0]?.text;

  if (typeof content !== 'string' || !content.trim()) {
    const finishReason: string = candidate?.finishReason ?? 'unknown';
    logInvoiceGeminiMetrics(
      buildInvoiceGeminiMetricsLine({
        model,
        httpMs: processingTimeMs,
        beforeFetchMs,
        bodyReadMs,
        parseMs: 0,
        processingTimeMs,
        usage,
      }),
    );
    // Log the full response so we can debug unexpected shapes
    const snippet = JSON.stringify(json ?? {}).slice(0, 800);
    throw new Error(`Gemini returned no content (finishReason: ${finishReason}). Response: ${snippet}`);
  }

  // Parse JSON + normalize
  let data: ReturnType<typeof pipelineFromLlmContent>;
  const parseStartedAt = Date.now();
  try {
    data = pipelineFromLlmContent(content);
  } catch (parseErr: unknown) {
    logInvoiceGeminiMetrics(
      buildInvoiceGeminiMetricsLine({
        model,
        httpMs: processingTimeMs,
        beforeFetchMs,
        bodyReadMs,
        parseMs: Date.now() - parseStartedAt,
        processingTimeMs,
        usage,
      }),
    );
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    throw new Error(`Gemini response JSON parse failed: ${msg}. Raw content (first 500): ${content.slice(0, 500)}`);
  }
  const parseMs = Date.now() - parseStartedAt;

  logInvoiceGeminiMetrics(
    buildInvoiceGeminiMetricsLine({
      model,
      httpMs: processingTimeMs,
      beforeFetchMs,
      bodyReadMs,
      parseMs,
      processingTimeMs,
      usage,
    }),
  );

  // Deterministic repairs: fix obvious field-level inconsistencies
  const repaired = repairExtractSectionsDeterministic(data);
  data = repaired.patched;

  // Recompute GST summary from authoritative line-level data (mutates in-place)
  recomputeGstSummaryFromAuthoritativeLines(data);

  // Handle non-Indian consolidated tax splits (Sales Tax / VAT → CGST+SGST halves) (mutates in-place)
  applyConsolidatedForeignTaxSplit(data);

  // Final normalize pass (returns new object)
  data = normalizeIndianGstInvoiceExtract(data);

  const repairNotes = repaired.notes ?? [];

  const base: ExtractionPipelineResult = {
    data,
    provider: 'gemini-vision',
    model,
    processingTimeMs,
    repairNotes: repairNotes.length ? repairNotes : undefined,
  };

  if (!includeDebug) return base;

  return {
    ...base,
    debug: {
      pipeline: 'gemini-vision',
      model,
      processing_time_ms: processingTimeMs,
      deterministic_repairs: repairNotes,
      note: 'Gemini Vision reads the image directly — no OCR step, no column reconstructor, no GST propagation engine needed.',
      vision_image: {
        width: prepared.width,
        height: prepared.height,
        original_width: prepared.originalWidth,
        original_height: prepared.originalHeight,
        bytes: prepared.buffer.length,
        mime_type: prepared.mimeType,
        resized: prepared.resized,
        reencoded: prepared.reencoded,
        oriented: prepared.oriented,
      },
    },
  };
}
