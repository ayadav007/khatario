import {
  GEMINI_INVOICE_MAX_OUTPUT_TOKENS,
  GEMINI_INVOICE_MEDIA_RESOLUTION,
  GEMINI_INVOICE_THINKING_BUDGET,
} from '@/lib/invoice-extract/latency/constants';
import { GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA } from '@/lib/invoice-extract/latency/gemini-invoice-response-schema';

export function buildGeminiVisionGenerationConfig(): Record<string, unknown> {
  return {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA,
    maxOutputTokens: GEMINI_INVOICE_MAX_OUTPUT_TOKENS,
    thinkingConfig: {
      thinkingBudget: GEMINI_INVOICE_THINKING_BUDGET,
    },
    mediaResolution: GEMINI_INVOICE_MEDIA_RESOLUTION,
  };
}

export function buildGeminiVisionGenerateContentBody(opts: {
  prompt: string;
  mimeType: string;
  base64: string;
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
    generationConfig: buildGeminiVisionGenerationConfig(),
  };
}
