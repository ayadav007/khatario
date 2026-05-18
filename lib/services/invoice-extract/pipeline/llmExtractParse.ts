import {
  coerceRawInvoiceJson,
  normalizeIndianGstInvoiceExtract,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';

export function parseLlmJson(text: string): unknown {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/\u0060\u0060\u0060(?:json)?\s*([\s\S]*?)\u0060\u0060\u0060/i);
  if (fenceMatch?.[1]) {
    cleaned = fenceMatch[1].trim();
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

export function pipelineFromLlmContent(content: string): IndianGstInvoiceExtract {
  const parsed = parseLlmJson(content);
  return normalizeIndianGstInvoiceExtract(coerceRawInvoiceJson(parsed));
}
