/**
 * Gemini Vision extraction pipeline.
 *
 * Sends the invoice image directly to Gemini 2.0 Flash as a native vision call.
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
import { repairExtractSectionsDeterministic } from '@/lib/services/invoice-extract/repair/sectionRepairEngine';
import { pipelineFromLlmContent } from '@/lib/services/invoice-extract/pipeline/llmExtractParse';
import type { ExtractionPipelineResult } from '@/lib/services/invoice-extract/pipeline/extractionPipelineTypes';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const TIMEOUT_MS = 90_000;

export async function runGeminiVisionPipeline(
  file: File,
  includeDebug: boolean,
  _extractionCtx?: { businessId?: string },
): Promise<ExtractionPipelineResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const model = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const mimeType = (file.type && file.type.startsWith('image/')) ? file.type : 'image/jpeg';

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString('base64');

  const startTime = Date.now();

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: VISION_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const processingTimeMs = Date.now() - startTime;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${body.slice(0, 600)}`);
  }

  const json = await res.json();

  // Gemini response shape: candidates[0].content.parts[0].text
  const candidate = json?.candidates?.[0];
  const content: unknown = candidate?.content?.parts?.[0]?.text;

  if (typeof content !== 'string' || !content.trim()) {
    const finishReason: string = candidate?.finishReason ?? 'unknown';
    // Log the full response so we can debug unexpected shapes
    const snippet = JSON.stringify(json ?? {}).slice(0, 800);
    throw new Error(`Gemini returned no content (finishReason: ${finishReason}). Response: ${snippet}`);
  }

  // Parse JSON + normalize
  let data: ReturnType<typeof pipelineFromLlmContent>;
  try {
    data = pipelineFromLlmContent(content);
  } catch (parseErr: unknown) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    throw new Error(`Gemini response JSON parse failed: ${msg}. Raw content (first 500): ${content.slice(0, 500)}`);
  }

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
    },
  };
}
