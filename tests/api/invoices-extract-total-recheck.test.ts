/**
 * POST /api/invoices/extract reads a bill a second time when the first read's lines do not
 * add up to the printed total, and keeps whichever read is closer.
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
import { resetDeadModelsForTests } from '@/lib/services/invoice-extract/pipeline/visionModelFallback';

function line(description: string, qty: number, rate: number, value: number, gst: number) {
  return {
    description,
    hsn_code: null,
    qty,
    unit: 'PCS',
    rate,
    discount_amount: null,
    gst_rate: gst,
    tax_mode: 'inclusive',
    taxable_value: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: value,
  };
}

/** Till roll: sugar 3.7 kg × 53 = 196.10 at 5%, salt 3 × 28 = 84 at 0%; pays 280.10. */
function bill(salt: { qty: number; value: number }) {
  return {
    supplier_name: 'DMART',
    supplier_gstin: '29AACCA8432H1ZM',
    invoice_number: 'B-1',
    invoice_date: '2026-10-17',
    tax_type: 'cgst_sgst',
    price_mode: 'inclusive',
    subtotal: 270.76,
    total_cgst: 4.67,
    total_sgst: 4.67,
    total_igst: null,
    round_off: null,
    grand_total: 280.1,
    items: [line('L SL SUGAR', 3.7, 53, 196.1, 5), line('TATA SALT-1kg', salt.qty, 28, salt.value, 0)],
    gst_summary: [],
  };
}

const misread = bill({ qty: 1, value: 28 });
const correct = bill({ qty: 3, value: 84 });

function geminiAnswer(invoice: unknown) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(invoice) }] } }] }), {
    status: 200,
  });
}

function scanRequest() {
  const form = new FormData();
  form.append('file', new File([Buffer.from('fake-image')], 'bill.jpg', { type: 'image/jpeg' }));
  form.append('business_id', 'biz-1');
  return new NextRequest('http://localhost/api/invoices/extract', { method: 'POST', body: form });
}

function promptOf(init: RequestInit): string {
  const body = JSON.parse(String(init.body));
  return body.contents[0].parts[0].text as string;
}

const savedEnv = { ...process.env };

beforeEach(() => {
  resetDeadModelsForTests();
  queryOne.mockReset().mockResolvedValue({ id: 'job-1' });
  query.mockReset().mockResolvedValue([]);
  process.env = {
    ...savedEnv,
    EXTRACTION_MODE: 'vision',
    INVOICE_VISION_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_MODELS: 'gemini-x',
    OCR_SERVICE_URL: 'http://127.0.0.1:4000',
  };
  delete process.env.GROQ_API_KEY;
  delete process.env.INVOICE_CONFIDENCE_ENGINE;
  delete process.env.INVOICE_EXTRACT_DEBUG;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env = savedEnv;
  jest.restoreAllMocks();
});

function saltLine(body: { data: { items: Array<{ item_name: string; quantity: number; amount: number }> } }) {
  return body.data.items.find((item) => item.item_name.includes('SALT'));
}

describe('POST /api/invoices/extract second read on a total mismatch', () => {
  it('reads again with the gap in the prompt and keeps the read that adds up', async () => {
    const prompts: string[] = [];
    const answers = [misread, correct];
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      prompts.push(promptOf(init));
      return geminiAnswer(answers.shift());
    }) as unknown as typeof fetch;

    const res = await POST(scanRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('SECOND READING');
    expect(prompts[1]).toContain('SECOND READING');
    expect(prompts[1]).toContain(`₹${body.total_recheck.first_lines_total.toFixed(2)}`);
    expect(prompts[1]).toContain('₹280.10');
    expect(saltLine(body)).toMatchObject({ quantity: 3, amount: 84 });
    expect(Math.abs(body.total_recheck.first_lines_total - 280.1)).toBeGreaterThan(1);
    expect(body.total_recheck).toMatchObject({ second_lines_total: 280.1, printed_total: 280.1, kept: 'second' });
  });

  it('keeps the first read when the second is further from the total', async () => {
    const worse = bill({ qty: 0.5, value: 14 });
    const answers = [misread, worse];
    global.fetch = jest.fn(async () => geminiAnswer(answers.shift())) as unknown as typeof fetch;

    const body = await (await POST(scanRequest())).json();

    expect(saltLine(body)).toMatchObject({ quantity: 1, amount: 28 });
    expect(body.total_recheck.kept).toBe('first');
  });

  it('reads once when the lines already add up to the printed total', async () => {
    const fetchMock = jest.fn(async () => geminiAnswer(correct));
    global.fetch = fetchMock as unknown as typeof fetch;

    const body = await (await POST(scanRequest())).json();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.total_recheck).toBeUndefined();
    expect(saltLine(body)).toMatchObject({ quantity: 3, amount: 84 });
  });

  it('keeps the first read when the second read fails', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      return calls === 1
        ? geminiAnswer(misread)
        : new Response('{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}', { status: 503 });
    }) as unknown as typeof fetch;

    const res = await POST(scanRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(body.total_recheck).toBeUndefined();
    expect(saltLine(body)).toMatchObject({ quantity: 1, amount: 28 });
  });
});
