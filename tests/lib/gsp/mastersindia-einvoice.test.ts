import { readFileSync } from 'fs';
import { join } from 'path';
import { GspError, clearGspTokenCache } from '@/lib/gsp/mastersindia/client';
import {
  IRN_DUPLICATE_CODES, miCancelIrn, miGenerateEwbByIrn, miGenerateIrn, miGetIrnByDocument,
} from '@/lib/gsp/mastersindia/einvoice';

const creds = { username: 'u@x.co', password: 'p' };
const G = '09AAAPG7885R002';
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const loginOk = json({ token: jwt(9e9) });
const fixture = (name: string) => json(JSON.parse(readFileSync(join(__dirname, '../../fixtures/gsp', name), 'utf8')));

// Replies are cloned so one shared `loginOk` can answer every test's login.
function replyWith(...queued: Response[]) {
  const replies = queued.map((r) => r.clone());
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const fn = (async (url: any, init: any) => {
    const r = replies.shift();
    if (!r) throw new Error('no reply queued');
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return r;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}
// The first call is the login; the second is the API call under test.
const apiCall = (f: ReturnType<typeof replyWith>) => f.calls[1];

beforeEach(() => clearGspTokenCache());

describe('miGenerateIrn', () => {
  it('parses the recorded success', async () => {
    const f = replyWith(loginOk, fixture('einvoice-generate-ok.json'));
    const r = await miGenerateIrn(creds, { user_gstin: G }, { fetch: f });
    expect(apiCall(f).url).toMatch(/\/einvoice\/$/);
    expect(apiCall(f).method).toBe('POST');
    expect(apiCall(f).body).toEqual({ user_gstin: G });
    expect(r.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof r.ackNo).toBe('string');
    expect(r.ackNo).toMatch(/^\d+$/);
    expect(r.ackDate.toISOString()).toBe('2026-11-28T00:11:48.000Z'); // 05:41:48 IST
    expect(r.signedQr.length).toBeGreaterThan(100);
    expect(r.signedInvoice).toBeTruthy();
    expect(r.status).toBe('ACT');
    expect(r.ewb).toBeNull();
    expect(r.ewbError).toBeNull();
    expect(r.pdfUrl).toMatch(/^https:\/\//);
    expect(r.requestId).toBeTruthy();
    expect(r.duplicate).toBe(false);
  });

  it('returns the e-way bill when it was generated with the IRN', async () => {
    const r = await miGenerateIrn(creds, {}, { fetch: replyWith(loginOk, fixture('einvoice-generate-with-ewb.json')) });
    expect(r.ewb).toEqual({
      number: '451010053171',
      generatedAt: new Date('2026-11-28T00:12:00.000Z'),
      validUntil: new Date('2026-11-30T18:29:00.000Z'),
      printUrl: expect.stringMatching(/^https:\/\//),
    });
  });

  it('flags the recorded duplicate answer and returns the same IRN', async () => {
    const first = await miGenerateIrn(creds, {}, { fetch: replyWith(loginOk, fixture('einvoice-generate-ok.json')) });
    clearGspTokenCache();
    const dup = await miGenerateIrn(creds, {}, { fetch: replyWith(loginOk, fixture('einvoice-duplicate.json')) });
    expect(dup.duplicate).toBe(true);
    expect(dup.irn).toBe(first.irn);
    expect(dup.ackNo).toBe(first.ackNo);
  });

  it('throws a rejected GspError with the portal code for a refused request', async () => {
    const err = await miGenerateIrn(creds, {}, { fetch: replyWith(loginOk, fixture('einvoice-rejected.json')) }).catch((e) => e);
    expect(err).toBeInstanceOf(GspError);
    expect([err.kind, err.nicCode, err.message]).toEqual(['rejected', '2276', '2276: Supplier PIN code cannot be 999999']);
  });

  it('reports the 6-digit HSN rule as a rejection', async () => {
    const err = await miGenerateIrn(creds, {}, { fetch: replyWith(loginOk, fixture('einvoice-rejected-hsn.json')) }).catch((e) => e);
    expect([err.kind, err.nicCode]).toEqual(['rejected', '2311']);
  });

  it('returns the IRN and the e-way bill error when only the e-way bill failed', async () => {
    const body = { results: { message: { AckNo: 142310015934535, AckDt: '2023-09-14 14:18:46', Irn: 'dd7c08b1'.padEnd(64, '0'), SignedInvoice: 's', SignedQRCode: 'q', EwbNo: null, EwbDt: null, EwbValidTill: null, EinvoicePdf: 'https://x/pdf', Status: 'ACT' },
      errorMessage: '', InfoDtls: '[{"InfCd": "EWBERR", "Desc": [{"ErrorCode": "4013", "ErrorMessage": "The distance between the pincodes given is too high or low."}]}]', status: 'Success', code: 200, requestId: 'R' } };
    const r = await miGenerateIrn(creds, {}, { fetch: replyWith(loginOk, json(body)) });
    expect([r.ackNo, r.ewb, r.ewbError]).toEqual(['142310015934535', null, 'The distance between the pincodes given is too high or low.']);
    expect(r.ackDate.toISOString()).toBe('2023-09-14T08:48:46.000Z');
  });

  it('gives a null ewbError for InfoDtls that is not JSON', async () => {
    const body = { results: { message: { AckNo: 1, AckDt: '2026-11-28 05:41:48', Irn: 'a'.repeat(64), SignedQRCode: 'q', Status: 'ACT' },
      errorMessage: '', InfoDtls: 'not json', status: 'Success', code: 200 } };
    const r = await miGenerateIrn(creds, {}, { fetch: replyWith(loginOk, json(body)) });
    expect(r.ewbError).toBeNull();
    expect(r.signedInvoice).toBeNull();
    expect(r.pdfUrl).toBeNull();
  });

  it('rejects a success reply that has no IRN', async () => {
    const body = { results: { message: { AckNo: 1, AckDt: '2026-11-28 05:41:48' }, errorMessage: '', InfoDtls: '', status: 'Success', code: 200 } };
    const err = await miGenerateIrn(creds, {}, { fetch: replyWith(loginOk, json(body)) }).catch((e) => e);
    expect([err.name, err.kind]).toEqual(['GspError', 'rejected']);
  });
});

describe('IRN_DUPLICATE_CODES', () => {
  it('holds the documented duplicate IRN code', () => {
    expect(IRN_DUPLICATE_CODES).toEqual(['2150']);
  });
});

describe('miGetIrnByDocument', () => {
  const args = { gstin: G, docNumber: 'KH5824707472', docDate: '28/11/2026' };

  it('sends the document as a GET query and parses the recorded reply', async () => {
    const f = replyWith(loginOk, fixture('einvoice-by-doc.json'));
    const r = await miGetIrnByDocument(creds, args, { fetch: f });
    const u = new URL(apiCall(f).url);
    expect(apiCall(f).method).toBe('GET');
    expect(u.pathname).toMatch(/\/get-einvoice-bydoc$/);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      user_gstin: G, document_type: 'INV', document_number: 'KH5824707472', document_date: '28/11/2026',
    });
    expect(r!.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(r!.ackNo).toMatch(/^\d+$/);
    expect(r!.status).toBe('ACT');
    expect(r!.ewb).toBeNull();
    expect(r!.pdfUrl).toBeNull();
    expect(r!.requestId).toBeNull();
    expect(r!.duplicate).toBe(false);
  });

  it('returns null when no IRN exists for the document', async () => {
    const r = await miGetIrnByDocument(creds, args, { fetch: replyWith(loginOk, fixture('einvoice-by-doc-missing.json')) });
    expect(r).toBeNull();
  });

  it('still throws for other rejections', async () => {
    const body = { results: { message: '', errorMessage: '2150: Duplicate IRN', status: 'Failed', code: 204 } };
    await expect(miGetIrnByDocument(creds, args, { fetch: replyWith(loginOk, json(body)) })).rejects.toMatchObject({ kind: 'rejected', nicCode: '2150' });
  });
});

describe('miCancelIrn', () => {
  it('sends the cancel body and parses CancelDate as IST', async () => {
    const f = replyWith(loginOk, fixture('einvoice-cancel-ok.json'));
    const r = await miCancelIrn(creds, { gstin: G, irn: 'i'.repeat(64), reason: '1', remarks: 'Wrong entry' }, { fetch: f });
    expect(apiCall(f).url).toMatch(/\/cancel-einvoice\/$/);
    expect(apiCall(f).body).toEqual({ user_gstin: G, irn: 'i'.repeat(64), cancel_reason: '1', cancel_remarks: 'Wrong entry', ewaybill_cancel: '' });
    expect(r.cancelledAt.toISOString()).toBe('2026-11-28T00:12:00.000Z');
  });

  it('throws when the reply has no CancelDate', async () => {
    const body = { results: { message: { Irn: 'x' }, errorMessage: '', status: 'Success', code: 200 } };
    await expect(miCancelIrn(creds, { gstin: G, irn: 'x', reason: '2', remarks: 'r' }, { fetch: replyWith(loginOk, json(body)) })).rejects.toMatchObject({ kind: 'rejected' });
  });
});

describe('miGenerateEwbByIrn', () => {
  it('sends the transport details and parses the recorded reply', async () => {
    const f = replyWith(loginOk, fixture('ewb-by-irn-ok.json'));
    const r = await miGenerateEwbByIrn(creds, {
      gstin: G, irn: 'i'.repeat(64), distanceKm: 269.6,
      transport: { mode: 'road', vehicleNumber: 'up16 ab1234', transporterId: '', transporterName: 'Fast Co' },
    }, { fetch: f });
    expect(apiCall(f).url).toMatch(/\/gen-ewb-by-irn\/$/);
    expect(apiCall(f).body).toEqual({
      user_gstin: G, irn: 'i'.repeat(64), transporter_id: '', transportation_mode: '1', transporter_document_number: '',
      transporter_document_date: '', vehicle_number: 'UP16AB1234', distance: 270, vehicle_type: 'R',
      transporter_name: 'Fast Co', data_source: 'erp',
    });
    expect(r).toEqual({
      number: '481010053170',
      generatedAt: new Date('2026-11-28T00:12:00.000Z'),
      validUntil: new Date('2026-11-30T18:29:00.000Z'),
      printUrl: expect.stringMatching(/^https:\/\//),
    });
  });

  it('maps rail mode, ODC and the transport document date', async () => {
    const f = replyWith(loginOk, fixture('ewb-by-irn-ok.json'));
    await miGenerateEwbByIrn(creds, {
      gstin: G, irn: 'i', distanceKm: 10,
      transport: { mode: 'rail', isOdc: true, docNumber: 'RR1', docDate: '2026-11-25' },
    }, { fetch: f });
    expect(apiCall(f).body).toMatchObject({
      transportation_mode: '2', vehicle_type: 'O', transporter_document_number: 'RR1', transporter_document_date: '25/11/2026',
    });
  });

  it('throws when the reply has no e-way bill number', async () => {
    const body = { results: { message: {}, errorMessage: '', status: 'Success', code: 200 } };
    await expect(miGenerateEwbByIrn(creds, { gstin: G, irn: 'i', distanceKm: 1, transport: { mode: 'road' } }, { fetch: replyWith(loginOk, json(body)) })).rejects.toMatchObject({ kind: 'rejected' });
  });
});
