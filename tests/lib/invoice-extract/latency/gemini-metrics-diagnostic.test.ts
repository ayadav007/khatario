import {
  buildInvoiceGeminiMetricsLine,
  formatInvoiceGeminiMetricsLog,
  invoiceGeminiMetricsEnabled,
  parseGeminiUsageMetadata,
} from '@/lib/invoice-extract/latency/gemini-metrics-diagnostic';

describe('invoice Gemini metrics diagnostic', () => {
  const prev = process.env.INVOICE_GEMINI_METRICS;

  afterEach(() => {
    if (prev === undefined) delete process.env.INVOICE_GEMINI_METRICS;
    else process.env.INVOICE_GEMINI_METRICS = prev;
  });

  it('is off unless INVOICE_GEMINI_METRICS is 1/true/yes', () => {
    delete process.env.INVOICE_GEMINI_METRICS;
    expect(invoiceGeminiMetricsEnabled()).toBe(false);
    process.env.INVOICE_GEMINI_METRICS = 'true';
    expect(invoiceGeminiMetricsEnabled()).toBe(true);
    process.env.INVOICE_GEMINI_METRICS = '1';
    expect(invoiceGeminiMetricsEnabled()).toBe(true);
  });

  it('reads usageMetadata counters and leaves omitted fields null', () => {
    expect(
      parseGeminiUsageMetadata({
        usageMetadata: {
          promptTokenCount: 1806,
          candidatesTokenCount: 412,
          totalTokenCount: 2218,
          thoughtsTokenCount: 0,
        },
      })
    ).toEqual({
      promptTokenCount: 1806,
      candidatesTokenCount: 412,
      totalTokenCount: 2218,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: null,
    });
  });

  it('reads thoughtsTokenCount and cachedContentTokenCount when Gemini includes them', () => {
    expect(
      parseGeminiUsageMetadata({
        usageMetadata: {
          promptTokenCount: 2000,
          candidatesTokenCount: 300,
          totalTokenCount: 2800,
          thoughtsTokenCount: 500,
          cachedContentTokenCount: 120,
        },
      })
    ).toEqual({
      promptTokenCount: 2000,
      candidatesTokenCount: 300,
      totalTokenCount: 2800,
      thoughtsTokenCount: 500,
      cachedContentTokenCount: 120,
    });
  });

  it('returns nulls when usageMetadata is absent', () => {
    expect(parseGeminiUsageMetadata({ candidates: [] })).toEqual({
      promptTokenCount: null,
      candidatesTokenCount: null,
      totalTokenCount: null,
      thoughtsTokenCount: null,
      cachedContentTokenCount: null,
    });
  });

  it('formats one structured log line without prompt or invoice fields', () => {
    const line = buildInvoiceGeminiMetricsLine({
      model: 'gemini-2.5-flash-lite',
      httpMs: 12735,
      beforeFetchMs: 80,
      bodyReadMs: 12,
      parseMs: 4,
      processingTimeMs: 12735,
      usage: {
        promptTokenCount: 1900,
        candidatesTokenCount: 400,
        totalTokenCount: 2300,
        thoughtsTokenCount: null,
        cachedContentTokenCount: null,
      },
    });
    const log = formatInvoiceGeminiMetricsLog(line);
    expect(log.startsWith('INVOICE_GEMINI_METRICS {')).toBe(true);
    expect(log).toContain('"model":"gemini-2.5-flash-lite"');
    expect(log).toContain('"http_ms":12735');
    expect(log).toContain('"prompt_tokens":1900');
    expect(log).toContain('"thoughts_tokens":null');
    expect(log).not.toMatch(/inline_data|base64|VISION_PROMPT|supplier|gstin|unit_price/i);
  });
});
