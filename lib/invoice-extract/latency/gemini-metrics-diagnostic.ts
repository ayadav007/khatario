/**
 * Temporary Gemini REST usage/timing diagnostic.
 * Enable with INVOICE_GEMINI_METRICS=1 (or true/yes). Logs one JSON line; never
 * logs keys, images, prompts, or invoice contents.
 */

const TRUE = new Set(['1', 'true', 'yes']);

export function invoiceGeminiMetricsEnabled(): boolean {
  const v = (process.env.INVOICE_GEMINI_METRICS || '').toLowerCase().trim();
  return TRUE.has(v);
}

export interface GeminiUsageTokenCounts {
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  thoughtsTokenCount: number | null;
  cachedContentTokenCount: number | null;
}

export interface InvoiceGeminiMetricsLine {
  model: string;
  http_ms: number;
  before_fetch_ms: number;
  body_read_ms: number;
  parse_ms: number;
  processing_time_ms: number;
  prompt_tokens: number | null;
  candidate_tokens: number | null;
  thoughts_tokens: number | null;
  total_tokens: number | null;
  cached_content_tokens: number | null;
}

function finiteInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

/**
 * Pull only the documented GenerateContentResponse.usageMetadata counters.
 * Missing object or fields become null (so we can tell omit vs zero).
 */
export function parseGeminiUsageMetadata(responseJson: unknown): GeminiUsageTokenCounts {
  const empty: GeminiUsageTokenCounts = {
    promptTokenCount: null,
    candidatesTokenCount: null,
    totalTokenCount: null,
    thoughtsTokenCount: null,
    cachedContentTokenCount: null,
  };
  if (!responseJson || typeof responseJson !== 'object') return empty;
  const usage = (responseJson as Record<string, unknown>).usageMetadata;
  if (!usage || typeof usage !== 'object') return empty;
  const u = usage as Record<string, unknown>;
  return {
    promptTokenCount: finiteInt(u.promptTokenCount),
    candidatesTokenCount: finiteInt(u.candidatesTokenCount),
    totalTokenCount: finiteInt(u.totalTokenCount),
    thoughtsTokenCount: finiteInt(u.thoughtsTokenCount),
    cachedContentTokenCount: finiteInt(u.cachedContentTokenCount),
  };
}

export function buildInvoiceGeminiMetricsLine(input: {
  model: string;
  httpMs: number;
  beforeFetchMs: number;
  bodyReadMs: number;
  parseMs: number;
  processingTimeMs: number;
  usage: GeminiUsageTokenCounts;
}): InvoiceGeminiMetricsLine {
  return {
    model: input.model,
    http_ms: input.httpMs,
    before_fetch_ms: input.beforeFetchMs,
    body_read_ms: input.bodyReadMs,
    parse_ms: input.parseMs,
    processing_time_ms: input.processingTimeMs,
    prompt_tokens: input.usage.promptTokenCount,
    candidate_tokens: input.usage.candidatesTokenCount,
    thoughts_tokens: input.usage.thoughtsTokenCount,
    total_tokens: input.usage.totalTokenCount,
    cached_content_tokens: input.usage.cachedContentTokenCount,
  };
}

export function formatInvoiceGeminiMetricsLog(line: InvoiceGeminiMetricsLine): string {
  return `INVOICE_GEMINI_METRICS ${JSON.stringify(line)}`;
}

export function logInvoiceGeminiMetrics(line: InvoiceGeminiMetricsLine): void {
  if (!invoiceGeminiMetricsEnabled()) return;
  console.log(formatInvoiceGeminiMetricsLog(line));
}
