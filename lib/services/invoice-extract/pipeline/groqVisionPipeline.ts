/**
 * Groq Vision extraction pipeline.
 *
 * Sends the invoice image directly to a Groq vision model, trying each model in
 * GROQ_VISION_MODELS (or GROQ_VISION_MODEL) until one answers.
 * No OCR step — the model reads the image natively via the OpenAI-compatible
 * chat completions API with image_url content parts.
 *
 * Post-LLM: same lightweight normalize/repair chain as the Gemini pipeline.
 */

import {
  recomputeGstSummaryFromAuthoritativeLines,
  applyConsolidatedForeignTaxSplit,
  normalizeIndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import { VISION_PROMPT } from '@/lib/gst-invoice-vision-prompt';
import { prepareInvoiceVisionImageServer } from '@/lib/invoice-extract/latency/prepare-vision-image-server';
import { repairExtractSectionsDeterministic } from '@/lib/services/invoice-extract/repair/sectionRepairEngine';
import { pipelineFromLlmContent } from '@/lib/services/invoice-extract/pipeline/llmExtractParse';
import type { ExtractionPipelineResult } from '@/lib/services/invoice-extract/pipeline/extractionPipelineTypes';
import {
  ProviderHttpError,
  groqVisionModels,
  runWithModelFallback,
} from '@/lib/services/invoice-extract/pipeline/visionModelFallback';

const GROQ_VISION_API = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 90_000;

export async function runGroqVisionPipeline(
  file: File,
  includeDebug: boolean,
  _extractionCtx?: { businessId?: string },
): Promise<ExtractionPipelineResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured');

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const fallbackMime = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
  // Same downscale as Gemini: Groq rejects base64 images over 4 MB, and bills may be up to 10 MB.
  let buffer: Buffer = rawBuffer;
  let mimeType = fallbackMime;
  try {
    const prepared = await prepareInvoiceVisionImageServer(rawBuffer, fallbackMime);
    buffer = prepared.buffer;
    mimeType = prepared.mimeType;
  } catch {
    // keep the original bytes
  }
  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

  const { res, model, processingTimeMs } = await runWithModelFallback('groq', groqVisionModels(), async (model) => {
    const startTime = Date.now();
    const res = await fetch(GROQ_VISION_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new ProviderHttpError('groq', model, res.status, await res.text());
    }
    return { res, model, processingTimeMs: Date.now() - startTime };
  });

  const json = await res.json();
  const content: unknown = json?.choices?.[0]?.message?.content;
  const returnedModel: string = json?.model || model;

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Groq Vision returned no content');
  }

  let data: ReturnType<typeof pipelineFromLlmContent>;
  try {
    data = pipelineFromLlmContent(content);
  } catch (parseErr: unknown) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    throw new Error(`Groq Vision JSON parse failed: ${msg}. Raw (first 500): ${content.slice(0, 500)}`);
  }

  // Deterministic repairs (mutates + returns new object)
  const repaired = repairExtractSectionsDeterministic(data);
  data = repaired.patched;

  // GST summary recompute + foreign tax split (both mutate in-place)
  recomputeGstSummaryFromAuthoritativeLines(data);
  applyConsolidatedForeignTaxSplit(data);

  // Final normalize
  data = normalizeIndianGstInvoiceExtract(data);

  const repairNotes = repaired.notes ?? [];

  const base: ExtractionPipelineResult = {
    data,
    provider: 'groq-vision',
    model: returnedModel,
    processingTimeMs,
    repairNotes: repairNotes.length ? repairNotes : undefined,
  };

  if (!includeDebug) return base;

  return {
    ...base,
    debug: {
      pipeline: 'groq-vision',
      model: returnedModel,
      processing_time_ms: processingTimeMs,
      deterministic_repairs: repairNotes,
      note: 'Groq vision model reads the image directly via OpenAI-compatible vision API.',
    },
  };
}
