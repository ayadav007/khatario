/**
 * POST /api/invoices/extract keeps scanning when a provider fails: Gemini → Groq → OCR service,
 * also with EXTRACTION_MODE=vision. When all fail the cashier gets one friendly message and
 * every provider's reason is logged and stored on the job.
 */
import { NextRequest } from 'next/server';

const queryOne = jest.fn();
const query = jest.fn();
// The route checks the session tenant and purchases permission; these tests cover extraction.
jest.mock('@/lib/security/require-tenant-permission', () => ({
  requireTenantPermission: async () => ({ ok: true, businessId: 'biz-1', userId: 'user-1' }),
}));
jest.mock('@/lib/db', () => ({ queryOne: (...a: unknown[]) => queryOne(...a), query: (...a: unknown[]) => query(...a) }));
jest.mock('@/lib/services/invoice-extract/extractionLearningTelemetry', () => ({
  insertInvoiceLearningEvent: jest.fn(),
  mergeLearningInsertPayload: jest.fn(() => ({})),
}));
jest.mock('@/lib/services/invoice-extract/invoiceExtractionTelemetry', () => ({
  recordInvoiceExtractionTelemetry: jest.fn(),
}));
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

import { POST } from '@/app/api/invoices/extract/route';
import { BILL_SCAN_FAILED_MESSAGE } from '@/lib/services/invoice-extract/extractionChain';
import { resetDeadModelsForTests } from '@/lib/services/invoice-extract/pipeline/visionModelFallback';

const INVOICE = { supplier_name: 'Test Traders', invoice_number: 'INV-1', items: [] };
const JOB_ID = 'job-1';

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;

function routeFetch(handlers: { gemini: Handler; groq: Handler; ocr: Handler }) {
  return jest.fn(async (url: string, init: RequestInit) => {
    if (url.includes('generativelanguage.googleapis.com')) return handlers.gemini(url, init);
    if (url.includes('api.groq.com')) return handlers.groq(url, init);
    if (url.includes('/api/invoices/upload')) return handlers.ocr(url, init);
    throw new Error(`unexpected fetch ${url}`);
  });
}

const geminiGone = () =>
  new Response('{"error":{"code":404,"message":"models/gemini-x is not found for API version v1beta","status":"NOT_FOUND"}}', {
    status: 404,
  });
const groqGone = () =>
  new Response(
    '{"error":{"message":"The model `meta-llama/llama-4-scout-17b-16e-instruct` does not exist or you do not have access to it.","code":"model_not_found"}}',
    { status: 404 },
  );
const groqOk = (_url: string, init: RequestInit) =>
  new Response(
    JSON.stringify({ model: JSON.parse(String(init.body)).model, choices: [{ message: { content: JSON.stringify(INVOICE) } }] }),
    { status: 200 },
  );
const ocrRefused = () => {
  throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
};
const ocrOk = () =>
  new Response(
    JSON.stringify({ success: true, data: { extraction: { provider: 'ocr', model: 'paddle', data: INVOICE } } }),
    { status: 200 },
  );

function scanRequest() {
  const form = new FormData();
  form.append('file', new File([Buffer.from('fake-image')], 'bill.jpg', { type: 'image/jpeg' }));
  form.append('business_id', 'biz-1');
  return new NextRequest('http://localhost/api/invoices/extract', { method: 'POST', body: form });
}

function failedJobUpdate() {
  return query.mock.calls.find(([sql, params]) => String(sql).includes('error_message') && params[0] === 'failed');
}

const savedEnv = { ...process.env };
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  resetDeadModelsForTests();
  queryOne.mockReset().mockResolvedValue({ id: JOB_ID });
  query.mockReset().mockResolvedValue([]);
  process.env = {
    ...savedEnv,
    EXTRACTION_MODE: 'vision',
    INVOICE_VISION_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'test-gemini-key',
    GROQ_API_KEY: 'test-groq-key',
    GEMINI_MODELS: 'gemini-x,gemini-y',
    GROQ_VISION_MODELS: 'meta-llama/llama-4-scout-17b-16e-instruct,qwen/qwen3.8-27b',
    OCR_SERVICE_URL: 'http://127.0.0.1:4000',
  };
  delete process.env.INVOICE_CONFIDENCE_ENGINE;
  delete process.env.INVOICE_EXTRACT_DEBUG;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = savedEnv;
  jest.restoreAllMocks();
});

describe('POST /api/invoices/extract provider fallback', () => {
  it('falls back from Gemini to Groq in vision mode, and to Groq’s next model', async () => {
    const fetchMock = routeFetch({
      gemini: geminiGone,
      groq: (url, init) => (JSON.parse(String(init.body)).model.startsWith('meta-llama') ? groqGone() : groqOk(url, init)),
      ocr: ocrOk,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST(scanRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.extraction_method).toBe('groq-vision/qwen/qwen3.8-27b');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/invoices/upload'))).toBe(false);
    // Gemini's reason is logged, not swallowed.
    expect(errorSpy.mock.calls.flat().join('\n')).toMatch(/gemini-vision failed: .*\[gemini-x\].*404/);
  });

  it('falls back to the OCR service in vision mode when both vision providers fail', async () => {
    global.fetch = routeFetch({ gemini: geminiGone, groq: groqGone, ocr: ocrOk }) as unknown as typeof fetch;

    const res = await POST(scanRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.extraction_method).toBe('ocr/paddle');
  });

  it('returns the cashier message and records every provider error when all fail', async () => {
    global.fetch = routeFetch({
      gemini: () => new Response('RESOURCE_EXHAUSTED quota', { status: 429 }),
      groq: groqGone,
      ocr: ocrRefused,
    }) as unknown as typeof fetch;

    const res = await POST(scanRequest());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toEqual({ success: false, error: BILL_SCAN_FAILED_MESSAGE, job_id: JOB_ID });
    expect(body.error).not.toMatch(/groq|gemini|model/i);

    const update = failedJobUpdate();
    expect(update).toBeDefined();
    const stored = String(update![1][1]);
    expect(stored).toMatch(/^gemini-vision: .*429/m);
    expect(stored).toMatch(/^groq-vision: .*model_not_found/m);
    expect(stored).toMatch(/^ocr-service: .*ECONNREFUSED/m);
    expect(stored).not.toContain('test-gemini-key');
    expect(stored).not.toContain('test-groq-key');

    const logged = errorSpy.mock.calls.flat().join('\n');
    expect(logged).toMatch(/gemini-vision failed/);
    expect(logged).toMatch(/groq-vision failed/);
    expect(logged).toMatch(/ocr-service failed/);
  });

  it('PDFs go straight to the OCR service', async () => {
    const fetchMock = routeFetch({ gemini: geminiGone, groq: groqGone, ocr: ocrOk });
    global.fetch = fetchMock as unknown as typeof fetch;
    const form = new FormData();
    form.append('file', new File([Buffer.from('%PDF-1.4')], 'bill.pdf', { type: 'application/pdf' }));
    form.append('business_id', 'biz-1');

    const res = await POST(new NextRequest('http://localhost/api/invoices/extract', { method: 'POST', body: form }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/invoices/upload');
  });
});
