# Masters India Connection and E-Way Bills Through the API: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business connects its Masters India account once, then generates, cancels, re-vehicles, extends and closes e-way bills from Khatario, with the monthly plan limit enforced.

**Architecture:** A small Masters India client (`lib/gsp/mastersindia/`) logs in with `token-auth/`, caches the JWT and turns the provider's in-body errors into one typed error. The connection is a new plugin in the existing integrations catalog (same pattern as Shiprocket), so connect, verify and disconnect need no new routes. Generation reuses `lib/gst/eway-json.ts` to build the NIC-shaped bill, maps it to Masters India's field names, calls the API **outside** any database transaction, then writes the existing `eway_bills` register.

**Tech Stack:** Next.js route handlers, TypeScript, PostgreSQL (`pg`), Jest. No new dependencies.

**Spec:** `docs/plan/GST_EINVOICE_EWAY_API.md`. API reference: the two Masters India PDFs (owner's Downloads folder, not in the repo): `EWB_API_EnterpriseDoc_Updated.pdf` for this plan.

## Global Constraints

- Tests touch only the disposable database `kh_phase2_test` (`PHASE2_TEST_DATABASE_URL`). Never run a migration against staging or production; write the file, do not apply it elsewhere.
- Never trust a client-sent `business_id`, `user_id` or `created_by`; take them from the session (`authorizeEwayBill`, `requireTenantPermission`).
- Never log or return a Masters India password, a JWT or a request body (bodies carry party data). Log endpoint path, `nicCode` and `requestId` only.
- Stage files by name; no `git add .`. Commit only where a step says so. Do not push or deploy.
- Base URL comes from `MASTERSINDIA_BASE_URL`. When `NODE_ENV === 'production'` and it is unset, every call fails with `GspError` kind `not_configured`. Elsewhere the default is `https://sandb-api.mastersindia.co/api/v1`.
- The GSP call is never made inside an open database transaction.
- Dates sent to Masters India are `DD/MM/YYYY`. Timestamps received are Indian Standard Time.
- Migration number: use the next free number at execution time (477 when this was written); if another branch has taken it, renumber the file and every reference in this plan.
- Plain-language UI copy; no em dashes.

## Review Focus

1. **Masters India answers "success" but our database write fails** (connection drop, unique conflict). Expected: the user is told the e-way bill number and that it was not saved, and a second click finds it by document number instead of generating a duplicate. Pinned in Task 6.
2. **Timeout after NIC already generated the bill.** Expected: one lookup by document number, then record it. Pinned in Task 6.
3. **Document number longer than 16 characters.** Expected: refused with a message naming the limit, never truncated. Pinned in Task 4.
4. **The connected Masters India account does not hold the document's GSTIN** (branch with its own GSTIN). Expected: the provider's rejection is shown in plain words with the GSTIN named, nothing recorded. Pinned in Task 6.
5. **A manually recorded bill is cancelled or extended.** Expected: no API call at all; only bills with `generated_via <> 'manual'` talk to Masters India. Pinned in Task 7.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/gsp/mastersindia/client.ts` (new) | Login, token cache, one `gspCall`, error and date parsing |
| `lib/gsp/mastersindia/credentials.ts` (new) | The only place that decides whose Masters India login is used |
| `lib/gsp/mastersindia/eway.ts` (new) | Field mapping and the six e-way bill calls |
| `lib/integrations/catalog.ts`, `lib/integrations/providers.ts` (modify) | The plugin entry and its `verify` |
| `lib/gst/eway-json.ts` (modify) | Exported `buildEwayBill`; ship-to, dispatch-from, address split, document-number refusal |
| `lib/gst/eway-generate.ts` (new) | Generate through the API and record |
| `lib/gst/eway-gsp-actions.ts` (new) | Cancel, Part B, extend, close through the API |
| `lib/gst/eway-bills.ts`, `lib/gst/eway-bill-records.ts`, `lib/gst/eway-bill-route.ts` (modify) | Error code, new columns in the view, validity override |
| `lib/subscription/limit-registry.ts` (modify) | `eway_bills` limit type |
| `app/api/eway-bills/generate/route.ts` (new), `app/api/eway-bills/[id]/route.ts` (modify) | HTTP entry points |
| `components/eway-bills/GenerateEwayBillDialog.tsx` (new) | The generate form |
| `database/migrations/477_eway_bills_gsp.sql` (new) | Four columns on `eway_bills` |
| `scripts/gsp/sandbox-smoke.ts` (new), `tests/fixtures/gsp/*.json` (new) | Recorded sandbox responses |

---

### Task 1: Masters India client

**Files:**
- Create: `lib/gsp/mastersindia/client.ts`
- Test: `tests/lib/gsp/mastersindia-client.test.ts`

**Interfaces:**
- Produces:

```ts
export type GspCredentials = { username: string; password: string };
export type GspErrorKind = 'auth' | 'rejected' | 'timeout' | 'unreachable' | 'not_configured';
export class GspError extends Error {
  constructor(readonly kind: GspErrorKind, message: string, readonly nicCode: string | null = null);
}
export type GspDeps = { fetch?: typeof fetch; now?: () => number };
export type GspResult<T> = { data: T; info: string | null; requestId: string | null };
export function gspBaseUrl(): string;                       // throws GspError('not_configured')
export async function gspLogin(creds: GspCredentials, deps?: GspDeps): Promise<string>;
export async function gspCall<T = any>(
  creds: GspCredentials,
  req: { method: 'GET' | 'POST'; path: string; query?: Record<string, string | number>; body?: unknown },
  deps?: GspDeps,
): Promise<GspResult<T>>;
export function clearGspTokenCache(): void;
export function parseGspDate(s: string | null | undefined): Date | null;
```

Rules the tests pin:
- Login: `POST {base}/token-auth/` with `{ username, password }`; success body `{ token }`; a body with top-level `error` → `GspError('auth')`.
- Every other call sends `Authorization: JWT <token>` and `Content-Type: application/json`. `path` is used exactly as given (POST paths end in `/`).
- Token cache: in-process `Map` keyed by `base + '|' + username`; reused while the JWT's `exp` (seconds, from the payload) is more than 60 s ahead of `now()`.
- HTTP 401 on a call: drop the cached token, log in again, retry the call once.
- Success is `results.code === 200 && results.status === 'Success'`. `data = results.message`, `info = results.InfoDtls || null`, `requestId = results.requestId ?? results.request_id ?? null`.
- Anything else with a `results` object → `GspError('rejected', text, nicCode)` where `text = results.errorMessage || (typeof results.message === 'string' ? results.message : '') || 'Masters India rejected the request'` and `nicCode = results.nic_code ?? leading digits of text before ':' ?? null`.
- Top-level `error` without `results` on a non-login call → `GspError('rejected', error_description || error)`.
- 30 000 ms `AbortController` timeout → `GspError('timeout')`. Network failure or a non-JSON body → `GspError('unreachable')`.
- `parseGspDate` accepts `15/09/2023 02:36:00 PM` and `2023-09-14 13:20:56`, both as IST; returns `null` for empty or unparseable input.

- [ ] **Step 1: Write the failing tests**

```ts
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
  process.env = { ...env, NODE_ENV: 'production', MASTERSINDIA_BASE_URL: '' };
  await expect(gspLogin(creds, { fetch: fakeFetch([]).fn })).rejects.toMatchObject({ kind: 'not_configured' });
  process.env = env;
});

it('parses both date shapes as IST', () => {
  expect(parseGspDate('15/09/2023 02:36:00 PM')!.toISOString()).toBe('2023-09-15T09:06:00.000Z');
  expect(parseGspDate('2023-09-14 13:20:56')!.toISOString()).toBe('2023-09-14T07:50:56.000Z');
  expect(parseGspDate('')).toBeNull();
});
```

- [ ] **Step 2: Run** `npx jest tests/lib/gsp/mastersindia-client.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `lib/gsp/mastersindia/client.ts`** to the interface and rules above.
- [ ] **Step 4: Run** the same command. Expected: 8 passed.
- [ ] **Step 5: Commit** `git add lib/gsp/mastersindia/client.ts tests/lib/gsp/mastersindia-client.test.ts` then `git commit -m "feat(gsp): Masters India client with token cache and typed errors"`.

---

### Task 2: Record sandbox responses (needs the owner)

The PDF's schemas and samples disagree in places and several enum spellings are not listed. This task replaces guesses with recorded facts before anything is built on them.

**Blocked until:** the owner puts the sandbox login in `.env.local` as `MASTERSINDIA_SANDBOX_USERNAME`, `MASTERSINDIA_SANDBOX_PASSWORD` and `MASTERSINDIA_SANDBOX_GSTIN` (the GSTIN linked to that sandbox account; the PDF uses `05AAABB0639G1Z8`). If it is not available, stop and ask; do not invent fixtures.

**Files:**
- Create: `scripts/gsp/sandbox-smoke.ts`, `tests/fixtures/gsp/eway-generate-ok.json`, `eway-generate-rejected.json`, `eway-get.json`, `eway-by-consigner.json`, `eway-partb-ok.json`, `eway-cancel-ok.json`, `eway-close.json`, `enums.md`

**Interfaces:**
- Consumes: `gspCall`, `gspLogin` from Task 1.
- Produces: fixture files holding the **whole response body** of each call, and `tests/fixtures/gsp/enums.md` listing the confirmed strings Tasks 5 and 7 use.

- [ ] **Step 1: Write `scripts/gsp/sandbox-smoke.ts`** (run with `npx ts-node --transpile-only`). It refuses to run unless `gspBaseUrl()` contains `sandb-api`. In order it: logs in; generates one e-way bill with the PDF's sample request (section #2, with `userGstin` and `gstin_of_consignor` set to the sandbox GSTIN, a fresh `document_number` like `KH/<epoch seconds>` and today's `document_date`); fetches it (`getEwayBillData/?action=GetEwayBill`); finds it by document (`action=GetEwayBillGeneratedByConsigner`); updates Part B (#4); cancels it (#3); sends one deliberately wrong pincode to capture a rejection; calls closure (#27) on a second generated bill. Each response body is written to its fixture file. It prints endpoint names and `code` only.
- [ ] **Step 2: Probe the unconfirmed enums** in the same script, one call each, recording which values the sandbox accepts in `enums.md`:
  - `state_of_consignor`: upper-case name (`UTTARAKHAND`) and the numeric code (`5`).
  - `vehicle_type` for over-dimensional cargo: `ODC` vs `Over Dimensional Cargo`.
  - `reason_of_cancel`: `Duplicate`, `Order Cancelled`, `Data Entry Mistake`, `Others`.
  - `reason_code_for_vehicle_updation`: `Due to Break Down`, `Due to Transhipment`, `Others`, `First Time`.
  - `sub_supply_type`: `Job Work`, `For Own Use`, `Exhibition or fairs`, `Line Sales`, `Recipient not known`, `SKD/CKD`.
- [ ] **Step 3: Run** `npx ts-node --transpile-only scripts/gsp/sandbox-smoke.ts`. Expected: every step prints `code 200` except the deliberate rejection (`204`).
- [ ] **Step 4: Check no secret was saved:** `grep -rn -i -E "password|token|Authorization" tests/fixtures/gsp/` prints nothing.
- [ ] **Step 5: If a recorded shape differs from what Task 1 assumed, fix Task 1's code and tests to the recorded shape,** then commit `git add scripts/gsp/sandbox-smoke.ts tests/fixtures/gsp` and `git commit -m "test(gsp): recorded sandbox responses and confirmed enums"`.

---

### Task 3: Connection plugin

**Files:**
- Create: `lib/gsp/mastersindia/credentials.ts`
- Modify: `lib/integrations/catalog.ts` (add an entry after `whatsapp-invoice-send`), `lib/integrations/providers.ts` (add `mastersindia` to `PROVIDERS`)
- Test: `tests/lib/gsp/mastersindia-plugin.test.ts`, `tests/db/gsp-credentials.db.test.ts`

**Interfaces:**
- Consumes: `gspLogin`, `clearGspTokenCache`, `GspError` (Task 1); `saveConnection`, `loadSecrets` (`lib/integrations/service.ts`).
- Produces: `export async function loadGspCredentials(businessId: string): Promise<GspCredentials | null>`; plugin id `gst-masters-india`; provider key `mastersindia`.

Catalog entry (exact values): `id: 'gst-masters-india'`, `category: 'billing'`, `title: 'GST e-invoice and e-way bill (Masters India)'`, `icon: 'Building2'`, `featureKeys: ['e_invoice', 'eway_bill']`, `featureKeysMatch: 'any'`, `ctaVariant: 'connect'`, `requiredPlatformModule: 'billing'`, `shortDescription: 'Generate e-way bills and e-invoices from Khatario through your Masters India account, without typing them again on the government portal.'`

Plugin: `provider: 'mastersindia'`; fields `{ key: 'username', label: 'Masters India username', help: 'The login of your Masters India account. Not your GST portal or e-way bill portal login.', kind: 'text', required: true }` and `{ key: 'password', label: 'Masters India password', kind: 'password', required: true }`.

`setupSteps` (exact copy):
1. `Create an account with Masters India and add your GSTIN there.`
2. `On the e-way bill portal (ewaybillgst.gov.in) open Registration, then For GSP, choose Masters India Private Limited and create an API user. Do the same on the e-invoice portal under API Registration if you issue e-invoices.`
3. `Give that API user to Masters India for your GSTIN, as their sign-up asks.`
4. `Enter your Masters India username and password here and save. Khatario checks the login before saving.`

`faq`: `Is this my GST portal password?` → `No. It is the login of your Masters India account. Khatario never asks for your GST portal password.`; `What does it cost?` → `Khatario adds no charge for this connection. Masters India charges as per your account with them.`; `I have more than one GSTIN.` → `Add every GSTIN to the same Masters India account. Khatario sends each document under the GSTIN it was issued from.`; `Can I disconnect?` → `Yes. Khatario forgets the login. E-way bills already generated stay valid.`

`overview`: two paragraphs in the same voice saying what it does (e-way bills from invoices and challans; cancel, change vehicle, extend and close from Khatario) and that e-invoices follow.

Provider: `verify` calls `gspLogin({ username: config.username, password: secrets.password })`; `GspError` kind `auth` → `{ ok: false, reason: 'rejected', message: 'Masters India did not accept this username and password.' }`; any other failure → `{ ok: false, reason: 'unreachable', message: 'Could not reach Masters India. Nothing was saved; try again.' }`. `countInFlight` resolves `0`. `onChanged` calls `clearGspTokenCache()`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/gsp/mastersindia-plugin.test.ts
import { getPluginEntry } from '@/lib/integrations/catalog';
import { getProvider } from '@/lib/integrations/providers';
import * as client from '@/lib/gsp/mastersindia/client';

it('lists the plugin with a username and a password field', () => {
  const e = getPluginEntry('gst-masters-india')!;
  expect(e.plugin.provider).toBe('mastersindia');
  expect(e.plugin.fields.map((f) => [f.key, f.kind, f.required])).toEqual([['username', 'text', true], ['password', 'password', true]]);
  expect(e.featureKeys).toEqual(['e_invoice', 'eway_bill']);
});

it('verify maps a refused login to rejected and an outage to unreachable', async () => {
  const p = getProvider('mastersindia')!;
  const login = jest.spyOn(client, 'gspLogin');
  login.mockRejectedValueOnce(new client.GspError('auth', 'no'));
  expect(await p.verify({ config: { username: 'u' }, secrets: { password: 'p' } })).toMatchObject({ ok: false, reason: 'rejected' });
  login.mockRejectedValueOnce(new client.GspError('timeout', 'slow'));
  expect(await p.verify({ config: { username: 'u' }, secrets: { password: 'p' } })).toMatchObject({ ok: false, reason: 'unreachable' });
  login.mockResolvedValueOnce('tok');
  expect(await p.verify({ config: { username: 'u' }, secrets: { password: 'p' } })).toEqual({ ok: true });
  expect(await p.countInFlight('any')).toBe(0);
});
```

```ts
// tests/db/gsp-credentials.db.test.ts — same header as tests/db/business-integrations.db.test.ts
// (PHASE2_TEST_DATABASE_URL guard, PAYMENT_ENCRYPTION_KEY default, seed one business the way that file does)
it('returns null until connected, then the stored login, and null again after disconnect', async () => {
  expect(await loadGspCredentials(businessId)).toBeNull();
  const saved = await saveConnection(businessId, 'gst-masters-india', { username: ' u@x.co ', password: 'S3cret' }, null, { verify: async () => ({ ok: true }) });
  expect(saved.ok).toBe(true);
  expect(await loadGspCredentials(businessId)).toEqual({ username: 'u@x.co', password: 'S3cret' });
  const row = await getPool().query(`SELECT secrets_enc::text AS s FROM business_integrations WHERE business_id = $1 AND provider = 'mastersindia'`, [businessId]);
  expect(row.rows[0].s).not.toContain('S3cret');
  await disconnect(businessId, 'mastersindia');
  expect(await loadGspCredentials(businessId)).toBeNull();
});
```

- [ ] **Step 2: Run** `npx jest tests/lib/gsp/mastersindia-plugin.test.ts` and `npx jest tests/db/gsp-credentials.db.test.ts --runInBand`. Expected: FAIL.
- [ ] **Step 3: Implement** the catalog entry, the provider and `loadGspCredentials` (returns `null` when `loadSecrets` is `null` or either value is missing).
- [ ] **Step 4: Run** both test files, plus `npx jest tests/db/business-integrations.db.test.ts --runInBand` and `npx tsc --noEmit`. Expected: all pass, no type errors.
- [ ] **Step 5: Commit** the five files: `git commit -m "feat(gsp): Masters India connection as an integrations plugin"`.

---

### Task 4: Fix and export the e-way bill builder

`lib/gst/eway-json.ts` builds the NIC-shaped bill but only exports the bulk-upload wrapper, always says transaction type 1, takes the ship-to state from the billing state, leaves `addr2` empty and silently cuts the document number.

**Files:**
- Modify: `lib/gst/eway-json.ts`
- Test: `tests/lib/gst/eway-json-dispatch.test.ts` (extend its `fakeDb`), new `tests/lib/gst/eway-json-shipto.test.ts`

**Interfaces:**
- Produces:

```ts
export type NicEwayBill = ReturnType<typeof bill> & { shipToGstin: string | null; shipToTradeName: string | null };
export function splitAddress(text: string | null | undefined, max = 120): [string, string];
export async function buildEwayBill(
  db: Queryable, businessId: string, sourceType: 'delivery_challan' | 'invoice', sourceId: string,
  opts: { distanceKm: number; shipToGstin?: string | null; shipTo?: { place: string; pincode: string; stateCode: string } | null },
): Promise<NicEwayBill>;
// ewayBulkJson keeps its signature and output: { version, billLists: [bill] } WITHOUT shipToGstin / shipToTradeName.
```

Rules:
- `docNo` longer than 16 characters → `EwayBillInputError('Document number <no> is longer than 16 characters, the limit for an e-way bill. Use a shorter number series.')`.
- `splitAddress` collapses whitespace; if the text fits in `max` it returns `[text, '']`; otherwise it cuts at the last space or comma at or before `max` and puts the rest (cut to `max`) in the second part.
- Ship-to differs when the document's `shipping_address` (else the customer's `shipping_address`) is non-empty and, lower-cased with non-alphanumerics removed, is not equal to the customer's `COALESCE(billing_address, address)`; or when `opts.shipToGstin` is given.
- When ship-to differs: `toAddr1/2`, `toPlace`, `toPincode` come from the shipping address, `shipping_city`, `shipping_pincode`; `actToStateCode = stateCodeFromName(customer.shipping_state) ?? toStateCode`; `shipToGstin = opts.shipToGstin || customer GSTIN || 'URP'`; `shipToTradeName = customer name`. Otherwise both are `null` and the billing address, city and pincode are used.
- Amendment (ruling after the Task 4 review): the customer's saved `shipping_city`, `shipping_pincode` and `shipping_state` are used only when the ship-to address in use is the customer's saved `shipping_address` (same normalised text). When the document carries its own different address, `opts.shipTo` must be given and supplies `toPlace`, `toPincode` and `actToStateCode`; without it → `EwayBillInputError('This document ships to an address that is not saved on the customer. Enter the ship-to city, PIN code and state.')`. `opts.shipTo`, when given, always wins. `ewayBulkJson` accepts and forwards `shipTo`.
- Dispatch-from differs when the seller's dispatch pincode (godown or branch address) is not the registration's pincode.
- `transactionType`: 1 neither, 2 ship-to only, 3 dispatch only, 4 both.
- For invoices `totInvValue = max(invoice.grand_total, computed sum)`; challans keep the computed sum.

- [ ] **Step 1: Write the failing tests** in `tests/lib/gst/eway-json-shipto.test.ts`, reusing the `fakeDb` shape of `eway-json-dispatch.test.ts` with the customer row extended by `billing_address`, `shipping_address`, `shipping_city`, `shipping_state`, `shipping_pincode` and the invoice row by `shipping_address`, `grand_total`:

```ts
it('refuses a document number over 16 characters', async () => {
  await expect(buildEwayBill(db({ invoiceNumber: 'INV/2026-27/000123' }), 'biz', 'invoice', 'inv', { distanceKm: 10 }))
    .rejects.toThrow(/longer than 16 characters/);
});
it('is a regular transaction when goods go to the billing address', async () => {
  const b = await buildEwayBill(db({}), 'biz', 'invoice', 'inv', { distanceKm: 10 });
  expect([b.transactionType, b.shipToGstin]).toEqual([1, null]);
});
it('is Bill To - Ship To when the shipping address differs, with the ship-to state and pincode', async () => {
  const b = await buildEwayBill(db({ shipping: { address: 'Plot 9, MIDC', city: 'Pune', state: 'Maharashtra', pincode: '411019' } }), 'biz', 'invoice', 'inv', { distanceKm: 10 });
  expect(b.transactionType).toBe(2);
  expect([b.toStateCode, b.actToStateCode, b.toPincode, b.toPlace]).toEqual([33, 27, 411019, 'Pune']);
  expect([b.shipToGstin, b.shipToTradeName]).toEqual(['33ADVFS4469F1ZJ', 'Chennai Buyer']);
});
it('uses URP when the customer has no GSTIN, and the typed GSTIN when one is given', async () => {
  const ship = { address: 'Plot 9', city: 'Pune', state: 'Maharashtra', pincode: '411019' };
  expect((await buildEwayBill(db({ customerGstin: null, shipping: ship }), 'biz', 'invoice', 'inv', { distanceKm: 10 })).shipToGstin).toBe('URP');
  expect((await buildEwayBill(db({ shipping: ship }), 'biz', 'invoice', 'inv', { distanceKm: 10, shipToGstin: '27AAACR5055K1ZO' })).shipToGstin).toBe('27AAACR5055K1ZO');
});
it('is type 3 when only the dispatch godown differs and type 4 when both differ', async () => { /* godown at pincode 635109 vs registration 560001 → 3; plus shipping above → 4 */ });
it('never reports a total below the invoice grand total', async () => {
  expect((await buildEwayBill(db({ grandTotal: 118050 }), 'biz', 'invoice', 'inv', { distanceKm: 10 })).totInvValue).toBe(118050);
});
it('splits a long address across two lines at a word boundary', () => {
  const [a, b] = splitAddress('A'.repeat(100) + ' ' + 'B'.repeat(60));
  expect([a.length, b.length]).toEqual([100, 60]);
});
it('the portal bulk JSON does not carry the ship-to fields', async () => {
  const j = await ewayBulkJson(db({}), 'biz', 'invoice', 'inv', { distanceKm: 10 });
  expect(j.billLists[0]).not.toHaveProperty('shipToGstin');
});
```

- [ ] **Step 2: Run** `npx jest tests/lib/gst/eway-json`. Expected: the new file FAILS, the dispatch file still passes.
- [ ] **Step 3: Implement** in `lib/gst/eway-json.ts`: `party()` selects the five extra customer columns and returns whether ship-to differs; `seller()` returns `dispatchDiffers`; `bill()` takes `transactionType`, `shipToGstin`, `shipToTradeName`, `totInvValue` override; `buildEwayBill` holds what `ewayBulkJson`'s body held; `ewayBulkJson` calls it and strips the two ship-to keys.
- [ ] **Step 4: Run** `npx jest tests/lib/gst` and `npx tsc --noEmit`. Expected: pass (update the dispatch test's `fakeDb` customer row if the new SELECT needs the extra columns).
- [ ] **Step 5: Commit** `git commit -m "fix(eway): ship-to and dispatch-from transaction types, address split, no silent document number cut"`.

---

### Task 5: Masters India e-way bill mapping and calls

**Files:**
- Create: `lib/gsp/mastersindia/eway.ts`
- Test: `tests/lib/gsp/mastersindia-eway.test.ts`

**Interfaces:**
- Consumes: `NicEwayBill` (Task 4), `gspCall`, `parseGspDate`, `GspError` (Task 1), `GST_STATE_NAMES` from `@/lib/tax/gstin`, fixtures and `enums.md` from Task 2.
- Produces:

```ts
export type EwayTransport = {
  mode: 'road' | 'rail' | 'air' | 'ship';
  vehicleNumber?: string | null; isOdc?: boolean;
  transporterId?: string | null; transporterName?: string | null;
  docNumber?: string | null; docDate?: string | null;            // YYYY-MM-DD
};
export type MiEwayResult = { ewbNumber: string; generatedAt: Date; validUntil: Date | null; printUrl: string | null; alert: string | null; duplicate: boolean; requestId: string | null };
export function toMiEwayPayload(bill: NicEwayBill, t: EwayTransport): Record<string, unknown>;   // throws EwayBillInputError on a transport rule
export async function miGenerateEway(creds: GspCredentials, payload: Record<string, unknown>, deps?: GspDeps): Promise<MiEwayResult>;
export async function miFindEwayByDocument(creds: GspCredentials, gstin: string, docNumber: string, docType: 'INV' | 'BIL' | 'CHL', deps?: GspDeps): Promise<MiEwayResult | null>;
export async function miCancelEway(creds, a: { gstin: string; ewbNumber: string; reason: 'duplicate' | 'order_cancelled' | 'data_entry' | 'others'; remark: string }, deps?): Promise<{ cancelledAt: Date }>;
export async function miUpdatePartB(creds, a: { gstin: string; ewbNumber: string; transport: EwayTransport; fromPlace: string; fromStateCode: string; reason: 'breakdown' | 'transhipment' | 'others' | 'first_time'; remark?: string }, deps?): Promise<{ validUntil: Date | null; printUrl: string | null }>;
export async function miExtendEway(creds, a: { gstin: string; ewbNumber: string; transport: EwayTransport; fromPlace: string; fromStateCode: string; fromPincode: string; remainingKm: number; reason: 'natural_calamity' | 'law_and_order' | 'transhipment' | 'accident' | 'others'; remark: string; inTransit?: 'road' | 'warehouse' | 'others' | null }, deps?): Promise<{ validUntil: Date }>;
export async function miCloseEway(creds, a: { gstin: string; ewbNumber: string; closureDate: string /* YYYY-MM-DD */; remark: string }, deps?): Promise<{ closedAt: Date }>;
```

Field mapping for `toMiEwayPayload` (left: Masters India key; right: source):

| Key | Value |
| --- | --- |
| `userGstin`, `gstin_of_consignor` | `bill.fromGstin` |
| `supply_type` | `'outward'` |
| `sub_supply_type` | by `bill.subSupplyType`: 1 `Supply`, 3 `Export`, 4 `Job Work`, 5 `For Own Use`, 8 `Others`, 9 `SKD/CKD`, 10 `Line Sales`, 11 `Recipient not known`, 12 `Exhibition or fairs` (spellings as confirmed in `enums.md`) |
| `sub_supply_description` | `bill.subSupplyDesc` |
| `document_type` | `INV` → `Tax Invoice`, `BIL` → `Bill of Supply`, `CHL` → `Delivery Challan` |
| `document_number`, `document_date` | `bill.docNo`, `bill.docDate` |
| `legal_name_of_consignor`, `address1_of_consignor`, `address2_of_consignor`, `place_of_consignor`, `pincode_of_consignor` | `fromTrdName`, `fromAddr1`, `fromAddr2`, `fromPlace`, `fromPincode` |
| `state_of_consignor`, `actual_from_state_name` | upper-case `GST_STATE_NAMES` of `fromStateCode`, `actFromStateCode` |
| `gstin_of_consignee`, `legal_name_of_consignee`, `address1_of_consignee`, `address2_of_consignee`, `place_of_consignee`, `pincode_of_consignee` | `toGstin`, `toTrdName`, `toAddr1`, `toAddr2`, `toPlace`, `toPincode` |
| `state_of_supply`, `actual_to_state_name` | upper-case names of `toStateCode`, `actToStateCode` |
| `transaction_type` | `bill.transactionType` |
| `ship_to_gstin`, `ship_to_tradename` | `bill.shipToGstin ?? ''`, `bill.shipToTradeName ?? ''` (blank for types 1 and 3) |
| `other_value`, `total_invoice_value`, `taxable_amount`, `cgst_amount`, `sgst_amount`, `igst_amount`, `cess_amount`, `cess_nonadvol_value` | `otherValue`, `totInvValue`, `totalValue`, `cgstValue`, `sgstValue`, `igstValue`, `cessValue`, `cessNonAdvolValue` |
| `transporter_id`, `transporter_name` | `t.transporterId ?? ''`, `t.transporterName ?? ''` |
| `transporter_document_number`, `transporter_document_date` | `t.docNumber ?? ''`, `t.docDate` as `DD/MM/YYYY` or `''` |
| `transportation_mode` | `Road`, `Rail`, `Air`, `Ship` |
| `transportation_distance` | `bill.transDistance` |
| `vehicle_number`, `vehicle_type` | `t.vehicleNumber ?? ''`, `Regular` or the ODC spelling from `enums.md` |
| fixed | `generate_status: 1`, `data_source: 'erp'`, `user_ref: ''`, `location_code: ''`, `eway_bill_status: 'ABC'`, `auto_print: 'N'`, `email: ''`, `delete_record: 'N'` |
| `itemList[]` | `product_name`, `product_description`, `hsn_code`, `quantity`, `unit_of_product` ← `qtyUnit`, `cgst_rate`, `sgst_rate`, `igst_rate`, `cess_rate`, `cessNonAdvol` ← `cessNonadvol`, `taxable_amount` |

Recorded in Task 2 (binding): the sandbox does **not** reject a second generate for the same document number; it answers `code 200` with the original `ewayBillNo` and an `alert` beginning `E-way bill number already generated on this document number`. `miGenerateEway` sets `duplicate: true` when `alert` matches `/already generated on this document number/i`, else `false`. `ewayBillNo` arrives as a number from generate and by-consigner and as a string from cancel and closure; always store it as a string. Spellings to send: state as the upper-case name; `vehicle_type` `Regular` or `ODC`; `reason_of_cancel` `Duplicate`, `Order Cancelled`, `Data Entry Mistake`, `Others` (only `Others` is confirmed by the sandbox); Part B reason `Due to Break Down`, `Due to Transhipment`, `Others`, `First Time`.

Transport rules (each throws `EwayBillInputError` with the quoted text): road with neither vehicle nor transporter → `Enter the vehicle number, or the transporter's GSTIN to generate Part A only`; rail, air or ship without document number and date → `Enter the transport document number and date`; more than 250 items → `An e-way bill can carry at most 250 items`.

Calls: generate `POST ewayBillsGenerate/`; find `GET getEwayBillData/` with `action=GetEwayBillGeneratedByConsigner`, `gstin`, `document_number`, `document_type` (the same label as above), returning `null` when rejected with `nicCode` `418`; cancel `POST ewayBillCancel/`; Part B `POST updateVehicleNumber/`; extend `POST ewayBillValidityExtend/` (`consignment_status: 'M'` and `transit_type: ''` normally; when `inTransit` is set, `mode_of_transport: '5'`, `consignment_status: 'T'`, `transit_type` `R`/`W`/`O`); close `POST ewayBillClosure/`. Reason strings come from `enums.md`.

- [ ] **Step 1: Write the failing tests:** one mapping test asserting every key in the table for a type-2 inter-state bill; one per transport rule; and one per call that feeds the Task 2 fixture through a fake `fetch` and asserts the parsed result, for example:

```ts
it('reads the generate response', async () => {
  const r = await miGenerateEway(creds, {}, { fetch: replyWith(loginOk, fixture('eway-generate-ok.json')) });
  expect(r.ewbNumber).toMatch(/^\d{12}$/);
  expect(r.generatedAt).toBeInstanceOf(Date);
  expect(r.printUrl).toMatch(/detailPrintPdf/);
});
it('returns null when no bill exists for the document', async () => {
  const none = { results: { message: '418: No record found.', status: 'No Content', code: 204, nic_code: '418' } };
  expect(await miFindEwayByDocument(creds, G, 'X/1', 'INV', { fetch: replyWith(loginOk, none) })).toBeNull();
});
it('sends Part B with the state as a name and the date as DD/MM/YYYY', async () => { /* assert the request body captured by the fake fetch */ });
```

- [ ] **Step 2: Run** `npx jest tests/lib/gsp/mastersindia-eway.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `lib/gsp/mastersindia/eway.ts`.** `printUrl` gets `https://` prefixed when the provider omits the scheme.
- [ ] **Step 4: Run** the test file and `npx tsc --noEmit`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "feat(gsp): Masters India e-way bill payload and calls"`.

---

### Task 6: Generate through the API and record

**Files:**
- Create: `database/migrations/477_eway_bills_gsp.sql`, `lib/gst/eway-generate.ts`, `app/api/eway-bills/generate/route.ts`
- Modify: `lib/gst/eway-bills.ts` (`EwayBillInputError` gains an optional third constructor argument `code?: string`), `lib/gst/eway-bill-route.ts` (`ewayBillErrorResponse` adds `code` to the JSON when set), `lib/gst/eway-bill-records.ts`, `lib/subscription/limit-registry.ts`
- Test: `tests/db/eway-generate.db.test.ts`

Migration (apply to `kh_phase2_test` only):

```sql
ALTER TABLE eway_bills
  ADD COLUMN IF NOT EXISTS generated_via VARCHAR(10) NOT NULL DEFAULT 'manual'
    CHECK (generated_via IN ('manual', 'api', 'irn')),
  ADD COLUMN IF NOT EXISTS gsp_request_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS print_url TEXT,
  ADD COLUMN IF NOT EXISTS transaction_type SMALLINT;
```

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5; `checkLimitInTransaction` (`lib/subscription.ts`); `createEwayBill`, `listEwayBills`.
- Produces:

```ts
// lib/subscription/limit-registry.ts: LimitCheckType gains 'eway_bills' → 'max_eway_bills_per_month';
// count: SELECT COUNT(*)::int FROM eway_bills WHERE business_id = $1 AND generated_via <> 'manual' AND generated_at >= DATE_TRUNC('month', CURRENT_DATE)

// lib/gst/eway-bill-records.ts
export async function createEwayBill(client, businessId, p: ParsedEwayBill, userId: string | null,
  gsp?: { generatedVia: 'api' | 'irn'; requestId: string | null; printUrl: string | null; transactionType: number | null }): Promise<EwayBillView>;
// EwayBillView gains: generated_via: 'manual' | 'api' | 'irn'; print_url: string | null.

// lib/gst/eway-generate.ts
export interface GenerateEwayInput {
  source_type: 'invoice' | 'delivery_challan'; source_id: string; distance_km: number;
  transport_mode?: 'road' | 'rail' | 'air' | 'ship'; vehicle_number?: string | null; is_odc?: boolean;
  transporter_gstin?: string | null; transporter_name?: string | null;
  transport_doc_number?: string | null; transport_doc_date?: string | null; ship_to_gstin?: string | null;
  ship_to_place?: string | null; ship_to_pincode?: string | null; ship_to_state_code?: string | null;   // all three or none → buildEwayBill opts.shipTo
}
export type EwayGenerateDeps = {
  loadCredentials?: typeof loadGspCredentials;
  generate?: typeof miGenerateEway; findByDocument?: typeof miFindEwayByDocument;
};
export async function generateEwayBillViaGsp(businessId: string, userId: string, input: GenerateEwayInput, deps?: EwayGenerateDeps): Promise<EwayBillView>;
```

Order of work inside `generateEwayBillViaGsp` and the error each step raises (`EwayBillInputError(message, status, code)`):
1. No credentials → `('Connect your Masters India account in Settings, Integrations first.', 409, 'GSP_NOT_CONNECTED')`.
2. An `eway_bills` row for this source with stored status `active` → `('This document already has an active e-way bill.', 409, 'EWAY_EXISTS')`.
3. `buildEwayBill`, then `toMiEwayPayload` (their own input errors pass through; the "not saved on the customer" error from Task 4 is re-thrown with status 422 and code `SHIP_TO_NEEDED`).
4. Limit: `BEGIN`, `checkLimitInTransaction(client, businessId, 'eway_bills')`, `COMMIT`. Not allowed → `(check.message, 403, 'LIMIT_EXCEEDED')`.
5. (`findByDocument` is never called before a normal generate, only in the failure paths of step 6, so a normal generate costs one call.)
6. `generate`. On `GspError`:
   - `timeout` or `unreachable` → call `findByDocument` once. Found → continue with that result. Not found or it also fails → `('Masters India did not answer. Check the e-way bill portal before trying again.', 502, 'GSP_NO_ANSWER')`.
   - (There is no duplicate rejection: per Task 2 a repeat generate returns the existing bill with `duplicate: true`. Treat that result as success and record it; that is how a generated-but-unsaved bill is recovered. When `duplicate` is true and the returned bill's status, read with one `GetEwayBill` call, is not active, do not record it: raise `('The e-way bill portal still holds an old e-way bill ' + ewbNumber + ' for this document number. Cancelled bills cannot be regenerated on the same number from here; check the portal.', 409, 'EWAY_STALE_DUPLICATE')`.)
   - `rejected` → `('E-way bill portal: ' + message + ' (GSTIN ' + fromGstin + ')', 422, 'GSP_REJECTED')`.
   - `auth` → `('Masters India no longer accepts the saved login. Reconnect in Settings, Integrations.', 409, 'GSP_AUTH')`.
   - `not_configured` → `('E-way bill generation is not set up on this server.', 503, 'GSP_NOT_CONFIGURED')`.
7. Record in one transaction: `setInvoiceAuditContext(client, { actorUserId: userId, action: 'eway_updated' })`, then `createEwayBill` with a `ParsedEwayBill` built from the bill (`doc_type`: `INV` → `tax_invoice`, `BIL` → `bill_of_supply`, `CHL` → `delivery_challan`; `sub_supply_type` from the code; `URP` GSTINs stored as `null`; `generated` and `valid_until` from the provider's result, falling back to `computeValidUntil` when the provider returns no validity and a vehicle was given; `goods_value = totInvValue`) and `gsp = { generatedVia: 'api', ... }`.
8. If step 7 throws → `('E-way bill ' + ewbNumber + ' was generated but could not be saved here. Click Generate again to record it.', 500, 'EWAY_NOT_SAVED')`. The next click reaches step 6's duplicate path and records it.

Route: `POST /api/eway-bills/generate`, `authorizeEwayBill(request, 'update')`, body is `GenerateEwayInput`, `201 { eway_bill }`, errors through `ewayBillErrorResponse`.

- [ ] **Step 1: Write the failing DB tests** (`tests/db/eway-generate.db.test.ts`; header, seeding of a business with a GSTIN, a customer, an item and a final invoice as in `tests/db/invoice-amend-fields.db.test.ts`; apply migration 477's SQL in `beforeAll` exactly as shipped, read from the file):

```ts
const ok: MiEwayResult = { ewbNumber: '301009218802', generatedAt: new Date(), validUntil: new Date(Date.now() + 864e5), printUrl: 'https://x/p', alert: null, requestId: 'R1' };
const deps = (over: Partial<EwayGenerateDeps> = {}): EwayGenerateDeps => ({
  loadCredentials: async () => ({ username: 'u', password: 'p' }),
  generate: jest.fn(async () => ok), findByDocument: jest.fn(async () => null), ...over,
});
const input = { source_type: 'invoice' as const, source_id: invoiceId, distance_km: 120, vehicle_number: 'KA01AB1234' };

it('records the generated bill and copies the number to the invoice', async () => {
  const v = await generateEwayBillViaGsp(businessId, userId, input, deps());
  expect([v.ewb_number, v.generated_via, v.print_url]).toEqual(['301009218802', 'api', 'https://x/p']);
  const inv = await pool.query('SELECT eway_bill_number FROM invoices WHERE id = $1', [invoiceId]);
  expect(inv.rows[0].eway_bill_number).toBe('301009218802');
});
it('refuses a second bill for the same document without calling the provider', async () => {
  const d = deps();
  await expect(generateEwayBillViaGsp(businessId, userId, input, d)).rejects.toMatchObject({ code: 'EWAY_EXISTS' });
  expect(d.generate).not.toHaveBeenCalled();
});
it('asks to connect when there is no login', async () => {
  await expect(generateEwayBillViaGsp(businessId, userId, input2, deps({ loadCredentials: async () => null })))
    .rejects.toMatchObject({ code: 'GSP_NOT_CONNECTED', status: 409 });
});
it('records nothing when the portal rejects, and names the GSTIN', async () => {
  const d = deps({ generate: jest.fn(async () => { throw new GspError('rejected', '702: GSTIN is not registered with this GSP', '702'); }) });
  await expect(generateEwayBillViaGsp(businessId, userId, input2, d)).rejects.toMatchObject({ code: 'GSP_REJECTED', message: expect.stringContaining(sellerGstin) });
  expect((await pool.query('SELECT 1 FROM eway_bills WHERE source_id = $1', [invoice2Id])).rowCount).toBe(0);
});
it('after a timeout, records the bill it finds by document number', async () => {
  const d = deps({ generate: jest.fn(async () => { throw new GspError('timeout', 'slow'); }), findByDocument: jest.fn(async () => ({ ...ok, ewbNumber: '311009218805' })) });
  expect((await generateEwayBillViaGsp(businessId, userId, input2, d)).ewb_number).toBe('311009218805');
});
it('after a timeout with nothing found, tells the user to check the portal', async () => {
  const d = deps({ generate: jest.fn(async () => { throw new GspError('timeout', 'slow'); }) });
  await expect(generateEwayBillViaGsp(businessId, userId, input3, d)).rejects.toMatchObject({ code: 'GSP_NO_ANSWER', status: 502 });
});
it('stops at the monthly limit before calling the provider', async () => {
  // put the business on a plan whose max_eway_bills_per_month is 1 (one api bill already exists this month)
  const d = deps();
  await expect(generateEwayBillViaGsp(businessId, userId, input3, d)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  expect(d.generate).not.toHaveBeenCalled();
});
it('a generated-but-unsaved bill is recorded by the next click', async () => {
  // first call: generate succeeds, createEwayBill fails (pre-insert a row with the same ewb_number under the same business for another source)
  // → EWAY_NOT_SAVED carrying the number; remove the clash; second call: generate returns the same bill with duplicate: true → recorded
});
it('manually recorded bills do not count towards the limit', async () => { /* buildLimitCountQuery('eway_bills') ignores generated_via = 'manual' */ });
```

- [ ] **Step 2: Run** `npx jest tests/db/eway-generate.db.test.ts --runInBand`. Expected: FAIL.
- [ ] **Step 3: Write the migration, apply it to the test database only** (`psql "$PHASE2_TEST_DATABASE_URL" -f database/migrations/477_eway_bills_gsp.sql`), then implement the limit type, the `createEwayBill` extension (new columns in the `INSERT` and in `toView`), `generateEwayBillViaGsp` and the route.
- [ ] **Step 4: Run** the DB test, `npx jest tests/lib/gst tests/lib/gsp` and `npx tsc --noEmit`. Expected: pass. `tsc` will list every `Record<LimitCheckType, …>` that needs an `eway_bills` entry (usage labels, module entitlements): add it with owner module `billing` and label `e-Way bills`.
- [ ] **Step 5: Commit** `git commit -m "feat(eway): generate e-way bills through Masters India with the monthly limit"`.

---

### Task 7: Cancel, change vehicle, extend and close through the API

**Files:**
- Create: `lib/gst/eway-gsp-actions.ts`
- Modify: `lib/gst/eway-bill-records.ts` (`EwayBillAction` fields, `updateEwayBill` validity override), `app/api/eway-bills/[id]/route.ts`
- Test: `tests/db/eway-gsp-actions.db.test.ts`

**Interfaces:**
- Consumes: the four `mi*` calls (Task 5), `loadGspCredentials`, `getEwayBill`, `updateEwayBill`.
- Produces:

```ts
// EwayBillAction additions (all optional in the type; required for API bills as noted)
//  cancel:  reason_code?: 'duplicate' | 'order_cancelled' | 'data_entry' | 'others'            (default 'others')
//  vehicle: from_place?, from_state_code?  (required), reason_code?: 'breakdown' | 'transhipment' | 'others' | 'first_time' (default 'others'),
//           transport_doc_number?, transport_doc_date?
//  extend:  from_place?, from_state_code?, from_pincode? (required), reason_code?: 'natural_calamity' | 'law_and_order' | 'transhipment' | 'accident' | 'others' (required),
//           in_transit?: 'road' | 'warehouse' | 'others' | null, vehicle_number?, transport_mode?
//  close:   remarks?  (required)
export type EwayActionDeps = { loadCredentials?: typeof loadGspCredentials; cancel?: typeof miCancelEway; partB?: typeof miUpdatePartB; extend?: typeof miExtendEway; close?: typeof miCloseEway };
/** Returns null for a manual bill or an action that has no API side (reject). */
export async function pushEwayActionToGsp(businessId: string, bill: EwayBillView, a: EwayBillAction, deps?: EwayActionDeps): Promise<{ validUntil?: Date | null } | null>;
export async function updateEwayBill(client, businessId, id, a, userId, now?, override?: { validUntil?: Date | null }): Promise<EwayBillView>;
```

Behaviour:
- `pushEwayActionToGsp` returns `null` at once when `bill.generated_via === 'manual'` or `a.action === 'reject'`.
- For API bills it first applies the same local guards `updateEwayBill` has (not active, 24-hour cancel window, extension window), so a doomed request is never sent; then checks the required fields (`EwayBillInputError('Enter the place and state the goods are in now')` and the like); then calls the provider. `GspError` is mapped with the same messages and codes as Task 6.
- The PATCH route: load the bill with `getEwayBill`; call `pushEwayActionToGsp` (no transaction open); then open the transaction and call `updateEwayBill`, passing `override.validUntil` for `extend` and `vehicle` when the provider returned one. For `extend`, `updateEwayBill` uses the override instead of `extendedValidUntil`.
- If the local write fails after the provider succeeded, respond `500` with `code: 'EWAY_NOT_SAVED'` and the message `The change was made on the e-way bill portal but could not be saved here. Reload and record it manually.`

- [ ] **Step 1: Write the failing DB tests:** for each of cancel, vehicle, extend, close: an API bill calls the fake once with the mapped arguments and the row changes; a manual bill changes the row and the fake is **not** called; an API bill outside the 24-hour cancel window is refused **without** calling the fake; a provider rejection leaves the row unchanged; extend stores the provider's `validUntil`, not the computed one.

```ts
it('cancels at the portal first, then locally', async () => {
  const cancel = jest.fn(async () => ({ cancelledAt: new Date() }));
  await patch(apiBillId, { action: 'cancel', reason: 'Order cancelled', reason_code: 'order_cancelled' }, { cancel });
  expect(cancel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ewbNumber: apiBillNumber, reason: 'order_cancelled', remark: 'Order cancelled' }), undefined);
  expect((await getEwayBill(pool, businessId, apiBillId))!.stored_status).toBe('cancelled');
});
it('never calls the provider for a manually recorded bill', async () => {
  const cancel = jest.fn();
  await patch(manualBillId, { action: 'cancel' }, { cancel });
  expect(cancel).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run** `npx jest tests/db/eway-gsp-actions.db.test.ts --runInBand`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/gst/eway-gsp-actions.ts`, the `updateEwayBill` override and the route change. Move the local guards into small exported predicates in `eway-bill-records.ts` so both callers share them.
- [ ] **Step 4: Run** the DB test, `npx jest tests/db/eway-generate.db.test.ts --runInBand` and `npx tsc --noEmit`. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "feat(eway): cancel, Part B, extend and close through Masters India"`.

---

### Task 8: Generate dialog and wiring

**Files:**
- Create: `components/eway-bills/GenerateEwayBillDialog.tsx`, `lib/gst/eway-generate-form.ts`
- Modify: `app/(app)/eway-bills/page.tsx`, `app/(app)/invoices/[id]/view/page.tsx`, `app/(app)/delivery-challans/[id]/page.tsx`, `components/invoices/EwayBillField.tsx`
- Test: `tests/lib/eway-generate-form.test.ts`

**Interfaces:**
- Consumes: `POST /api/eway-bills/generate`, `PATCH /api/eway-bills/[id]` with the Task 7 fields, `GET /api/integrations/gst-masters-india`.
- Produces: `GenerateEwayBillDialog` props `{ sourceType: 'invoice' | 'delivery_challan'; sourceId: string; goodsValue: number; defaultVehicle?: string | null; defaultTransporterGstin?: string | null; defaultTransporterName?: string | null; onDone(bill): void; onClose(): void }`, and a pure helper in `lib/gst/eway-generate-form.ts`:

```ts
export type EwayForm = { distance: string; mode: 'road' | 'rail' | 'air' | 'ship'; vehicle: string; transporterGstin: string; transporterName: string; docNumber: string; docDate: string; isOdc: boolean; shipToGstin: string; shipToPlace: string; shipToPincode: string; shipToStateCode: string };
export function validateEwayForm(f: EwayForm): { ok: true; body: Omit<GenerateEwayInput, 'source_type' | 'source_id'> } | { ok: false; errors: Partial<Record<keyof EwayForm, string>> };
```

Rules for `validateEwayForm` (messages exact): distance not a whole number 0 to 4000 → `Enter the distance in km, 0 to 4000. Enter 0 to use the portal's distance.`; vehicle given but not matching `/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^TM[A-Z0-9]{6}$/` after upper-casing and removing spaces → `Enter a valid vehicle number, like KA01AB1234`; GSTIN fields not 15 characters and not `URP` → `Enter a 15-character GSTIN`; the three transport rules of Task 5 with the same texts.

Screen behaviour:
- Invoice view and challan page: a **Generate e-way bill** button when the plan has `eway_bill`, the document is final and has no active bill. A hint line `Goods are worth more than ₹50,000, so an e-way bill is needed before they move.` when `goodsValue > 50000`.
- `EwayBillField` keeps the manual number entry under a link `Generated it on the portal? Enter the number`.
- On `GSP_NOT_CONNECTED` or `GSP_AUTH` the dialog shows the server message and a button **Connect Masters India** to `/settings/integrations/gst-masters-india`; the typed values stay in the dialog.
- On `SHIP_TO_NEEDED` the dialog reveals three fields (`Ship-to city`, `Ship-to PIN code`, `Ship-to state` as a state select) with the server message; `validateEwayForm` requires all three once any is filled (PIN code 6 digits → `Enter a 6-digit PIN code`). `app/api/eway-bills/export/route.ts` forwards optional `ship_to_place`, `ship_to_pincode`, `ship_to_state_code` query parameters to `ewayBulkJson`.
- Any other error shows the server message above the form; the form stays filled.
- `/eway-bills` rows with `generated_via <> 'manual'` show a `Print` link (`print_url`) and their cancel, vehicle, extend and close dialogs ask for the Task 7 fields; manual rows keep today's dialogs.

- [ ] **Step 1: Write the failing test** for `validateEwayForm`: one case per rule above and one valid road case asserting the exact `body`.
- [ ] **Step 2: Run** `npx jest tests/lib/eway-generate-form.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper, the dialog and the four page changes, following the dialog and button components already used on `/eway-bills`.
- [ ] **Step 4: Run** the test, `npx tsc --noEmit` and `npx next lint --dir components/eway-bills --dir "app/(app)/eway-bills"`. Expected: pass, no new warnings.
- [ ] **Step 5: Commit** `git commit -m "feat(eway): generate e-way bill dialog on invoices, challans and the register"`.

---

### Task 9: Staging checklist and project records

**Files:**
- Create: `docs/superpowers/plans/2026-11-27-gsp-connection-eway-bills-staging-checklist.md`
- Modify: `docs/roadmap.md`, `docs/project.log.md`, `docs/SERVER_INFRASTRUCTURE.md` (the new env variable)

- [ ] **Step 1: Write the checklist** (the owner runs it on staging after deploy, sandbox only): set `MASTERSINDIA_BASE_URL` to the sandbox URL; apply migration 477 (owner approval); connect with a wrong password (refused, nothing saved) then the right one; generate from a final invoice by road; generate Part A only with a transporter GSTIN; generate from a delivery challan; a 17-character invoice number is refused with the limit named; Bill To Ship To invoice shows transaction type 2 in the portal print; cancel within 24 hours; change vehicle; close; a manual bill still cancels without a portal call; the limit stops the eleventh bill on a Growth plan; disconnect, then Generate asks to connect.
- [ ] **Step 2: Move the roadmap card** to Now with what was built and what is next; append the project log entry (format in `docs/brain.md`); add `MASTERSINDIA_BASE_URL` to the env section of `docs/SERVER_INFRASTRUCTURE.md`.
- [ ] **Step 3: Run the whole suite once:** `npx jest tests/lib/gsp tests/lib/gst` and `npx jest tests/db/gsp-credentials.db.test.ts tests/db/eway-generate.db.test.ts tests/db/eway-gsp-actions.db.test.ts tests/db/business-integrations.db.test.ts --runInBand`. Expected: all pass.
- [ ] **Step 4: Commit** `git commit -m "docs: staging checklist for Masters India e-way bills"`.
