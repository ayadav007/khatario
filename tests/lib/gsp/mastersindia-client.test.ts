import { GspError, clearGspTokenCache, gspCall, gspLogin, parseGspDate } from '@/lib/gsp/mastersindia/client';

const creds = { username: 'u@x.co', password: 'p' };
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(replies: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const r = replies.shift();
    if (!r) throw new Error('no reply queued');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

beforeEach(() => clearGspTokenCache());

it('logs in once and reuses the token until it nears expiry', async () => {
  const now = 1_700_000_000_000;
  const f = fakeFetch([
    json({ token: jwt(now / 1000 + 3600) }),
    json({ results: { message: { a: 1 }, status: 'Success', code: 200 } }),
    json({ results: { message: { a: 2 }, status: 'Success', code: 200 } }),
  ]);
  const deps = { fetch: f.fn, now: () => now };
  expect((await gspCall(creds, { method: 'GET', path: 'x/' }, deps)).data).toEqual({ a: 1 });
  expect((await gspCall(creds, { method: 'GET', path: 'x/' }, deps)).data).toEqual({ a: 2 });
  expect(f.calls.filter((c) => c.url.endsWith('/token-auth/'))).toHaveLength(1);
  expect((f.calls[1].init.headers as any).Authorization).toMatch(/^JWT h\./);
});

it('maps an e-way bill rejection to GspError with the NIC code', async () => {
  const f = fakeFetch([
    json({ token: jwt(9e9) }),
    json({ results: { message: '437: Invalid Supplier ship from State Code for the given pincode.', status: 'No Content', code: 204, nic_code: '437' } }),
  ]);
  await expect(gspCall(creds, { method: 'POST', path: 'ewayBillsGenerate/', body: {} }, { fetch: f.fn }))
    .rejects.toMatchObject({ kind: 'rejected', nicCode: '437' });
});

it('maps an e-invoice rejection (errorMessage) and reads the code from the text', async () => {
  const f = fakeFetch([
    json({ token: jwt(9e9) }),
    json({ results: { message: '', errorMessage: '3038: Seller details Details:Pincode-101301 does not exists', status: 'Failed', code: 204 } }),
  ]);
  await expect(gspCall(creds, { method: 'POST', path: 'einvoice/', body: {} }, { fetch: f.fn }))
    .rejects.toMatchObject({ kind: 'rejected', nicCode: '3038' });
});

it('treats a refused login as auth', async () => {
  const f = fakeFetch([json({ error: 'Unable to login with provided credential' })]);
  await expect(gspLogin(creds, { fetch: f.fn })).rejects.toMatchObject({ kind: 'auth' });
});

it('logs in again once after a 401', async () => {
  const f = fakeFetch([
    json({ token: jwt(9e9) }), json({ detail: 'Signature has expired.' }, 401),
    json({ token: jwt(9e9) }), json({ results: { message: { ok: true }, status: 'Success', code: 200 } }),
  ]);
  expect((await gspCall(creds, { method: 'GET', path: 'x/' }, { fetch: f.fn })).data).toEqual({ ok: true });
});

it('reports timeout and unreachable separately', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await expect(gspLogin(creds, { fetch: fakeFetch([abort]).fn })).rejects.toMatchObject({ kind: 'timeout' });
  await expect(gspLogin(creds, { fetch: fakeFetch([new TypeError('fetch failed')]).fn })).rejects.toMatchObject({ kind: 'unreachable' });
});

it('refuses to guess a base URL in production', async () => {
  const env = process.env;
  process.env = { ...env, NODE_ENV: 'production', MASTERSINDIA_BASE_URL: '' } as NodeJS.ProcessEnv;
  try {
    await expect(gspLogin(creds, { fetch: fakeFetch([]).fn })).rejects.toMatchObject({ kind: 'not_configured' });
  } finally {
    process.env = env;
  }
});

it('parses both date shapes as IST', () => {
  expect(parseGspDate('15/09/2023 02:36:00 PM')!.toISOString()).toBe('2023-09-15T09:06:00.000Z');
  expect(parseGspDate('2023-09-14 13:20:56')!.toISOString()).toBe('2023-09-14T07:50:56.000Z');
  expect(parseGspDate('')).toBeNull();
});

it('reads a 24-hour date with no AM/PM and trailing space as IST', () => {
  expect(parseGspDate('06/12/2026 23:59:59 ')?.toISOString()).toBe('2026-12-06T18:29:59.000Z');
  expect(parseGspDate('06/12/2026 00:00:00')?.toISOString()).toBe('2026-12-05T18:30:00.000Z');
});
