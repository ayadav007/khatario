import {
  GEMINI_INVOICE_MAX_OUTPUT_TOKENS,
  GEMINI_INVOICE_MEDIA_RESOLUTION,
  GEMINI_INVOICE_THINKING_BUDGET,
  GEMINI_INVOICE_THINKING_LEVEL,
} from '@/lib/invoice-extract/latency/constants';
import { GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA } from '@/lib/invoice-extract/latency/gemini-invoice-response-schema';

/** Gemini 3+ controls thinking with thinkingLevel; 2.x with thinkingBudget. */
function geminiThinkingConfig(model?: string): Record<string, unknown> {
  const major = /gemini-(\d+)/.exec(model ?? '');
  if (major && Number(major[1]) >= 3) {
    // 'low' is the lowest level every 3.x Flash / Flash-Lite model accepts (3.8 Flash has no 'minimal').
    return { thinkingLevel: GEMINI_INVOICE_THINKING_LEVEL };
  }
  return { thinkingBudget: GEMINI_INVOICE_THINKING_BUDGET };
}

export function buildGeminiVisionGenerationConfig(model?: string): Record<string, unknown> {
  return {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA,
    maxOutputTokens: GEMINI_INVOICE_MAX_OUTPUT_TOKENS,
    thinkingConfig: geminiThinkingConfig(model),
    mediaResolution: GEMINI_INVOICE_MEDIA_RESOLUTION,
  };
}

export function buildGeminiVisionGenerateContentBody(opts: {
  prompt: string;
  mimeType: string;
  base64: string;
  model?: string;
}): Record<string, unknown> {
  return {
    contents: [
      {
        parts: [
          { text: opts.prompt },
          { inline_data: { mime_type: opts.mimeType, data: opts.base64 } },
        ],
      },
    ],
    generationConfig: buildGeminiVisionGenerationConfig(opts.model),
  };
}
