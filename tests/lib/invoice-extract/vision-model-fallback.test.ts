/**
 * Invoice vision providers walk a model list: a retired model (404 / model_not_found /
 * decommissioned) is skipped for an hour and the next model is tried.
 */
jest.mock('@/lib/invoice-extract/latency/prepare-vision-image-server', () => ({
  prepareInvoiceVisionImageServer: jest.fn(async (buffer: Buffer, mimeType: string) => ({
    buffer,
    mimeType,
    width: 1,
    height: 1,
    originalWidth: 1,
    originalHeight: 1,
    resized: false,
    reencoded: false,
    oriented: false,
  })),
}));
jest.mock('@/lib/invoice-extract/latency/gemini-metrics-diagnostic', () => ({
  buildInvoiceGeminiMetricsLine: jest.fn(() => ''),
  logInvoiceGeminiMetrics: jest.fn(),
  parseGeminiUsageMetadata: jest.fn(() => null),
}));

import { runGeminiVisionPipeline } from '@/lib/services/invoice-extract/pipeline/geminiVisionPipeline';
import { runGroqVisionPipeline } from '@/lib/services/invoice-extract/pipeline/groqVisionPipeline';
import {
  DEFAULT_GEMINI_VISION_MODELS,
  DEFAULT_GROQ_VISION_MODELS,
  geminiVisionModels,
  groqVisionModels,
  isModelDead,
  isModelGoneError,
  markModelDead,
  resetDeadModelsForTests,
} from '@/lib/services/invoice-extract/pipeline/visionModelFallback';
import { buildGeminiVisionGenerationConfig } from '@/lib/invoice-extract/latency/gemini-generation-config';

const INVOICE_JSON = JSON.stringify({ supplier_name: 'Test Traders', invoice_number: 'INV-1', items: [] });

function geminiOk() {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: INVOICE_JSON }] } }] }), { status: 200 });
}
function groqOk(model: string) {
  return new Response(JSON.stringify({ model, choices: [{ message: { content: INVOICE_JSON } }] }), { status: 200 });
}
function fail(status: number, body: string) {
  return new Response(body, { status });
}

function geminiModelOf(url: string): string {
  return decodeURIComponent(/models\/([^:]+):generateContent/.exec(url)![1]);
}

const imageFile = () => new File([Buffer.from('fake-image')], 'bill.jpg', { type: 'image/jpeg' });

const savedEnv = { ...process.env };
let fetchMock: jest.Mock;

beforeEach(() => {
  resetDeadModelsForTests();
  process.env = { ...savedEnv, GEMINI_API_KEY: 'test-gemini-key', GROQ_API_KEY: 'test-groq-key' };
  delete process.env.GEMINI_MODELS;
  delete process.env.GEMINI_MODEL;
  delete process.env.GROQ_VISION_MODELS;
  delete process.env.GROQ_VISION_MODEL;
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = savedEnv;
  jest.restoreAllMocks();
});

describe('model lists', () => {
  it('prefers the comma list, then the single model, then current defaults', () => {
    expect(geminiVisionModels({ GEMINI_MODELS: 'a, b ,,a', GEMINI_MODEL: 'c' })).toEqual(['a', 'b']);
    expect(geminiVisionModels({ GEMINI_MODEL: ' c ' })).toEqual(['c']);
    expect(geminiVisionModels({})).toEqual(DEFAULT_GEMINI_VISION_MODELS);
    expect(groqVisionModels({ GROQ_VISION_MODELS: 'x,y' })).toEqual(['x', 'y']);
    expect(groqVisionModels({ GROQ_VISION_MODEL: 'z' })).toEqual(['z']);
    expect(groqVisionModels({})).toEqual(DEFAULT_GROQ_VISION_MODELS);
  });

  it('defaults no longer include the shut-down models', () => {
    expect(DEFAULT_GEMINI_VISION_MODELS).not.toContain('gemini-2.0-flash');
    expect(DEFAULT_GROQ_VISION_MODELS).not.toContain('meta-llama/llama-4-scout-17b-16e-instruct');
  });

  it('recognises retired-model answers from both providers', () => {
    expect(isModelGoneError(404, '')).toBe(true);
    expect(
      isModelGoneError(400, '{"error":{"message":"The model `x` does not exist","code":"model_not_found"}}'),
    ).toBe(true);
    expect(isModelGoneError(400, '{"error":{"code":"model_decommissioned"}}')).toBe(true);
    expect(isModelGoneError(400, 'models/gemini-2.0-flash is not found for API version v1beta')).toBe(true);
    expect(isModelGoneError(429, 'RESOURCE_EXHAUSTED')).toBe(false);
  });

  it('forgets a dead model after an hour', () => {
    markModelDead('gemini', 'old', 0);
    expect(isModelDead('gemini', 'old', 59 * 60 * 1000)).toBe(true);
    expect(isModelDead('gemini', 'old', 61 * 60 * 1000)).toBe(false);
  });
});

describe('Gemini model fallback', () => {
  it('moves past a retired model and skips it on the next scan', async () => {
    process.env.GEMINI_MODELS = 'gemini-2.0-flash,gemini-3.6-flash';
    fetchMock.mockImplementation(async (url: string) =>
      geminiModelOf(url) === 'gemini-2.0-flash'
        ? fail(404, '{"error":{"code":404,"message":"models/gemini-2.0-flash is not found for API version v1beta","status":"NOT_FOUND"}}')
        : geminiOk(),
    );

    const first = await runGeminiVisionPipeline(imageFile(), false);
    expect(first.model).toBe('gemini-3.6-flash');
    expect(first.data.supplier_name).toBe('Test Traders');
    expect(fetchMock.mock.calls.map(([u]) => geminiModelOf(u))).toEqual(['gemini-2.0-flash', 'gemini-3.6-flash']);

    fetchMock.mockClear();
    await runGeminiVisionPipeline(imageFile(), false);
    expect(fetchMock.mock.calls.map(([u]) => geminiModelOf(u))).toEqual(['gemini-3.6-flash']);
  });

  it('sends the key in a header, not the URL, and uses thinkingLevel on Gemini 3', async () => {
    process.env.GEMINI_MODELS = 'gemini-3.6-flash';
    fetchMock.mockResolvedValue(geminiOk());
    await runGeminiVisionPipeline(imageFile(), false);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('test-gemini-key');
    expect(init.headers['x-goog-api-key']).toBe('test-gemini-key');
    expect(JSON.parse(init.body).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(buildGeminiVisionGenerationConfig('gemini-2.5-flash-lite').thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it('tries the next model on quota errors without marking the model dead', async () => {
    process.env.GEMINI_MODELS = 'gemini-3.6-flash,gemini-3.5-flash-lite';
    fetchMock.mockImplementation(async (url: string) =>
      geminiModelOf(url) === 'gemini-3.6-flash' ? fail(429, 'RESOURCE_EXHAUSTED') : geminiOk(),
    );
    const res = await runGeminiVisionPipeline(imageFile(), false);
    expect(res.model).toBe('gemini-3.5-flash-lite');
    expect(isModelDead('gemini', 'gemini-3.6-flash')).toBe(false);
  });

  it('reports every model it tried when all fail', async () => {
    process.env.GEMINI_MODELS = 'gemini-a,gemini-b';
    fetchMock.mockImplementation(async (url: string) => fail(404, `model ${geminiModelOf(url)} not found`));
    await expect(runGeminiVisionPipeline(imageFile(), false)).rejects.toThrow(/\[gemini-a\].*\[gemini-b\]/);
  });
});

describe('Groq model fallback', () => {
  it('moves past a decommissioned model to the next one', async () => {
    process.env.GROQ_VISION_MODELS = 'meta-llama/llama-4-scout-17b-16e-instruct,qwen/qwen3.8-27b';
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model;
      return model.startsWith('meta-llama')
        ? fail(404, `{"error":{"message":"The model \`${model}\` does not exist or you do not have access to it.","type":"invalid_request_error","code":"model_not_found"}}`)
        : groqOk(model);
    });
    const res = await runGroqVisionPipeline(imageFile(), false);
    expect(res.model).toBe('qwen/qwen3.8-27b');
    expect(isModelDead('groq', 'meta-llama/llama-4-scout-17b-16e-instruct')).toBe(true);
  });

  it('does not try another model after a timeout', async () => {
    process.env.GROQ_VISION_MODELS = 'm1,m2';
    fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    await expect(runGroqVisionPipeline(imageFile(), false)).rejects.toThrow(/\[m1\].*timeout/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
