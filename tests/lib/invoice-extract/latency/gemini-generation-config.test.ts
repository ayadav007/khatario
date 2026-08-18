import { buildGeminiVisionGenerateContentBody, buildGeminiVisionGenerationConfig } from '@/lib/invoice-extract/latency/gemini-generation-config';
import { GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA } from '@/lib/invoice-extract/latency/gemini-invoice-response-schema';
import {
  GEMINI_INVOICE_MAX_OUTPUT_TOKENS,
  GEMINI_INVOICE_MEDIA_RESOLUTION,
  GEMINI_INVOICE_THINKING_BUDGET,
} from '@/lib/invoice-extract/latency/constants';

describe('Gemini vision request (latency experiment)', () => {
  it('sets JSON schema, output cap, thinkingBudget 0, and mediaResolution', () => {
    const cfg = buildGeminiVisionGenerationConfig();
    expect(cfg.temperature).toBe(0);
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.responseSchema).toBe(GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA);
    expect(cfg.maxOutputTokens).toBe(GEMINI_INVOICE_MAX_OUTPUT_TOKENS);
    expect(GEMINI_INVOICE_MAX_OUTPUT_TOKENS).toBe(32768);
    expect(cfg.thinkingConfig).toEqual({ thinkingBudget: GEMINI_INVOICE_THINKING_BUDGET });
    expect(cfg.mediaResolution).toBe(GEMINI_INVOICE_MEDIA_RESOLUTION);
    expect(GEMINI_INVOICE_THINKING_BUDGET).toBe(0);
  });

  it('schema keeps printed invoice fields and does not ask Gemini for unit_price', () => {
    const json = JSON.stringify(GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA);
    expect(json).not.toContain('unit_price');
    expect(json).not.toContain('printed_rate');
    expect(json).not.toContain('mapping_rule');
    expect(json).toContain('"rate"');
    expect(json).toContain('"taxable_value"');
    expect(json).toContain('"line_total"');
    expect(json).toContain('"gst_rate"');
    expect(json).toContain('"tax_mode"');
    expect(json).toContain('"qty"');
    expect(json).toContain('"discount_on_tax_inclusive"');
  });

  it('request body still sends the prompt plus inline image bytes', () => {
    const body = buildGeminiVisionGenerateContentBody({
      prompt: 'PROMPT',
      mimeType: 'image/jpeg',
      base64: 'abc',
    });
    const parts = (body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0].parts;
    expect(parts[0]).toEqual({ text: 'PROMPT' });
    expect(parts[1]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: 'abc' } });
    expect((body.generationConfig as { thinkingConfig: { thinkingBudget: number } }).thinkingConfig.thinkingBudget).toBe(0);
  });
});
