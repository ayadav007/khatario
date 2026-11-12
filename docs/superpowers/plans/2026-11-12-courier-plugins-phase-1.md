# Courier plugins, Phase 1 (plugin framework + Shiprocket) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shiprocket becomes a plugin under Settings → Integrations, with its credentials in a generic `business_integrations` table, checked against Shiprocket on save, and removable; nothing about booking, tracking or returns changes.

**Architecture:** `lib/integrations/catalog.ts` (browser-safe) declares each plugin's text and form fields. `lib/integrations/providers.ts` (server-only) holds each provider's credential check and in-flight count. `lib/integrations/service.ts` is the only module that touches the new table. The two existing readers of Shiprocket credentials and the online-store settings API are re-pointed at the service; the Shiprocket client, booking, webhook and returns code is not edited.

**Tech Stack:** Next.js App Router (TypeScript), PostgreSQL via `pg` (`lib/db.ts`), Jest (`npm test`), AES-256-GCM via `lib/payments/secret-encryption.ts`.

**Spec:** `docs/superpowers/specs/2026-11-12-courier-plugins-phase-1-design.md`

## Global Constraints

- Migrations are run by the agent **only** against the disposable DB `kh_phase2_test` (`PHASE2_TEST_DATABASE_URL`). Never against staging or production. Migration 476 is written, not applied elsewhere.
- DB tests run only when `PHASE2_TEST_DATABASE_URL` is set. A skipped suite is not a pass; say so if the variable is missing.
- Never trust a client-sent `business_id`, `user_id` or `created_by`. Every route takes the business and user from `requireTenantPermission`.
- No route, log line or error message may contain a secret, a ciphertext or a token hash.
- Commit only if the owner has asked for commits in this run. Work on `main`. Stage files by name; never `git add .`, reset, stash or clean.
- Deploy order: migration 476 first, then code. After the deploy, run the migration's `INSERT ... ON CONFLICT DO NOTHING` once more.
- The old columns `store_shiprocket_email`, `store_shiprocket_password_enc`, `store_shiprocket_webhook_token_hash` are not dropped and are never read by new code.
- Not edited: `lib/store/delivery/shiprocket.ts` (except the one added function in Task 3), `lib/fulfilment/shiprocket-booking.ts` and `lib/returns/pickup.ts` (except their help strings in Task 5), `app/api/webhooks/store/shiprocket/route.ts`, anything under `phone/`.
- No plan gate on the plugin routes (spec section 11.1).
- Exact copy:
  - Rejected login: `Shiprocket did not accept this email and password. Use the API user from Shiprocket → Settings → API, not your main login.`
  - Unreachable: `Could not reach Shiprocket. Nothing was saved; try again.`
  - Token collision: `Generate a new webhook token`
  - Not connected (help strings): `Connect Shiprocket first: Settings → Integrations → Shiprocket, add the Shiprocket API user.`
- UI is verified by `npm run typecheck`, `npm run lint` and the staging checklist at the end; do not run local browser checks (owner preference).
- After code changes, run `graphify update .`.

## Review Focus

Inputs the spec implies but does not spell out; each has a test in the task named.

1. **Password with leading or trailing spaces.** Config values are trimmed; secrets are stored exactly as typed. (Task 4)
2. **Save pressed twice, or two tabs saving at once.** One row per business and provider; the second save updates it. (Task 4)
3. **Existing row with a webhook token but no password.** Reported as not connected; saving credentials keeps the token; the webhook still resolves. (Task 4)
4. **PUT body with a non-string, an over-long value or an unknown key.** 400, nothing saved. Limit: 255 characters per value. (Tasks 4 and 6)
5. **Disconnect when nothing is connected, or pressed twice.** Succeeds without error and changes nothing. (Task 4)

## File structure

| File | Responsibility |
|---|---|
| `database/migrations/476_business_integrations.sql` (new) | Table, unique index, copy of existing Shiprocket connections. |
| `lib/integrations/catalog.ts` (modify) | `shipping` category, `Truck` icon, `plugin` block type, Shiprocket entry, five coming-soon entries, `getPluginEntry`. |
| `lib/integrations/webhook-token.ts` (new) | Browser-safe token generator. |
| `lib/integrations/providers.ts` (new) | Server-only registry: `verify`, `countInFlight`, `onChanged` per provider. |
| `lib/integrations/service.ts` (new) | All SQL against `business_integrations`. |
| `lib/store/delivery/shiprocket.ts` (modify) | Adds `verifyShiprocketLogin` only. |
| `lib/store/delivery/index.ts`, `lib/store/order-lifecycle.ts` (modify) | Read credentials and webhook token through the service. |
| `app/api/integrations/route.ts`, `app/api/integrations/[id]/route.ts` (new) | List, read, save, disconnect. |
| `app/api/settings/online-store/route.ts` (modify) | Shiprocket fields served from and saved through the service. |
| `hooks/useIntegrationMarketplaceStatus.ts`, `components/settings/IntegrationMarketplaceList.tsx` (modify) | Plugin entries: status from `/api/integrations`, card opens the plugin page. |
| `app/(app)/settings/integrations/[id]/page.tsx`, `components/settings/integrations/PluginPage.tsx`, `components/settings/integrations/PluginSettingsForm.tsx` (new) | The plugin page and its generated form. |
| `app/(app)/settings/online-store/page.tsx` (modify) | Shiprocket form removed; dropdown depends on the connection. |

---

### Task 1: Migration 476

**Files:**
- Create: `database/migrations/476_business_integrations.sql`
- Test: `tests/db/business-integrations.db.test.ts` (created here, extended in Task 4)

**Interfaces:**
- Produces: table `business_integrations(id, business_id, provider, config jsonb, secrets_enc jsonb, settings jsonb, webhook_token_hash, last_verified_at, connected_by, created_at, updated_at)`, `UNIQUE (business_id, provider)`, unique index `uq_business_integrations_webhook_token (provider, webhook_token_hash) WHERE webhook_token_hash IS NOT NULL`.

- [ ] **Step 1: Write the migration.** Copy the `CREATE TABLE`, the index and the `INSERT ... SELECT ... ON CONFLICT (business_id, provider) DO NOTHING` exactly from spec sections 5.1 and 5.2. Header comment in the style of `357_shiprocket_booking.sql`. Check that no other file is numbered 476 (`ls database/migrations | sort -n | tail -3`); use the next free number if one is.

- [ ] **Step 2: Apply to the test DB only.**

```bash
psql "$PHASE2_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/476_business_integrations.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX`, `INSERT 0 n`. Confirm first that the URL's database name is `kh_phase2_test`.

- [ ] **Step 3: Write the failing test** in `tests/db/business-integrations.db.test.ts`. Follow the setup of `tests/db/shiprocket-booking.db.test.ts` (the `PHASE2_TEST_DATABASE_URL` guard, four businesses `A`, `B`, `C`, `D` inserted in `beforeAll` each with a `business_settings` row, deleted in `afterAll`; later tasks use all four). The test reads the migration file, extracts the `INSERT INTO business_integrations ... ;` statement, and runs it:

```ts
test('copy: old Shiprocket columns become one connection, and running it twice changes nothing', async () => {
  await pool.query(
    `INSERT INTO business_settings (business_id, store_shiprocket_email, store_shiprocket_password_enc, store_shiprocket_webhook_token_hash)
     VALUES ($1, 'api@shop.test', 'CIPHERTEXT', $2)
     ON CONFLICT (business_id) DO UPDATE SET store_shiprocket_email = EXCLUDED.store_shiprocket_email,
       store_shiprocket_password_enc = EXCLUDED.store_shiprocket_password_enc,
       store_shiprocket_webhook_token_hash = EXCLUDED.store_shiprocket_webhook_token_hash`,
    [A, HASH_A],
  );
  await pool.query(COPY_SQL);
  await pool.query(COPY_SQL);
  const { rows } = await pool.query(
    `SELECT config, secrets_enc, webhook_token_hash FROM business_integrations WHERE business_id = $1 AND provider = 'shiprocket'`, [A]);
  expect(rows).toEqual([{ config: { email: 'api@shop.test' }, secrets_enc: { password: 'CIPHERTEXT' }, webhook_token_hash: HASH_A }]);
});

test('copy: a business with no Shiprocket columns gets no row', async () => {
  // B has a business_settings row with all three columns NULL
  expect((await pool.query(`SELECT 1 FROM business_integrations WHERE business_id = $1`, [B])).rowCount).toBe(0);
});
```

- [ ] **Step 4: Run.** `npx jest tests/db/business-integrations.db.test.ts --runInBand`. Expected: 2 passed (not skipped).

- [ ] **Step 5: Commit** (if commits were asked for): `git add database/migrations/476_business_integrations.sql tests/db/business-integrations.db.test.ts`.

---

### Task 2: Catalogue

**Files:**
- Modify: `lib/integrations/catalog.ts`
- Create: `lib/integrations/webhook-token.ts`
- Modify (category lists): `components/layout/Sidebar.tsx`, `lib/settings-mobile-title.ts`, `lib/settings-module-registry.ts` wherever the marketplace categories `billing | sms | ai | crm` are listed
- Test: `tests/lib/integrations/catalog.test.ts`

**Interfaces:**
- Produces:

```ts
export type PluginFieldKind = 'text' | 'email' | 'password' | 'webhook_token';
export type PluginField = { key: string; label: string; help?: string; kind: PluginFieldKind; required: boolean };
export type IntegrationPlugin = {
  provider: string;
  overview: string[];
  setupSteps: string[];
  faq: { q: string; a: string }[];
  fields: PluginField[];
};
// IntegrationCatalogEntry gains: plugin?: IntegrationPlugin
export function getPluginEntry(id: string): (IntegrationCatalogEntry & { plugin: IntegrationPlugin }) | null;
// lib/integrations/webhook-token.ts
export function generateWebhookToken(length?: number): string;   // default 32, [A-Za-z0-9], crypto.getRandomValues
```

- [ ] **Step 1: Write the failing tests.**

```ts
test('shipping category exists and is a valid URL param', () => {
  expect(getCategoryLabel('shipping')).toBe('Shipping');
  expect(normalizeCategoryParam('shipping')).toBe('shipping');
});
test('Shiprocket is a live plugin with the three fields', () => {
  const e = getPluginEntry('shiprocket')!;
  expect(e.category).toBe('shipping');
  expect(e.comingSoon).toBeFalsy();
  expect(e.plugin.provider).toBe('shiprocket');
  expect(e.plugin.fields.map((f) => [f.key, f.kind, f.required])).toEqual([
    ['email', 'email', true], ['password', 'password', true], ['webhook_token', 'webhook_token', false],
  ]);
  expect(e.plugin.fields[0].label).toBe('API user email');
});
test('planned couriers are coming-soon cards without a plugin block', () => {
  for (const id of ['delhivery', 'nimbuspost', 'ithink-logistics', 'porter', 'borzo']) {
    const e = INTEGRATION_CATALOG.find((x) => x.id === id)!;
    expect(e.category).toBe('shipping');
    expect(e.comingSoon).toBe(true);
    expect(e.plugin).toBeUndefined();
    expect(getPluginEntry(id)).toBeNull();
  }
});
test('every plugin has unique field keys and at most one webhook_token', () => {
  for (const e of INTEGRATION_CATALOG.filter((x) => x.plugin)) {
    const keys = e.plugin!.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(e.plugin!.fields.filter((f) => f.kind === 'webhook_token').length).toBeLessThanOrEqual(1);
  }
});
test('entries without a plugin block are unchanged', () => {
  expect(INTEGRATION_CATALOG.find((x) => x.id === 'email-smtp')!.configureHref).toBe('/settings/email');
});
test('generateWebhookToken gives 32 letters and digits, different each time', () => {
  const t = generateWebhookToken();
  expect(t).toMatch(/^[A-Za-z0-9]{32}$/);
  expect(generateWebhookToken()).not.toBe(t);
});
```

- [ ] **Step 2: Run.** `npx jest tests/lib/integrations/catalog.test.ts`. Expected: FAIL (`getPluginEntry` not exported).

- [ ] **Step 3: Implement.**
  - Add `'shipping'` to `IntegrationCategory`, `CATEGORY_LABELS` ("Shipping") and `MARKETPLACE_CATEGORY_PARAMS`; add `'Truck'` to `IntegrationIconKey`.
  - Shiprocket entry: `id: 'shiprocket'`, `title: 'Shiprocket'`, `icon: 'Truck'`, `featureKeys: []`, `ctaVariant: 'connect'`, no `configureHref`. `shortDescription`: "Book couriers, print labels and manifests, and track parcels through your Shiprocket account."
  - Field text: `email` label "API user email", help "The API user you create in Shiprocket under Settings → API. Not your main Shiprocket login."; `password` label "API user password"; `webhook_token` label "Tracking webhook token", help "Paste this token and the address above into Shiprocket under Settings → API → Webhooks, so parcel updates reach Khatario."
  - `overview` (2–3 paragraphs: what it does today: rates at checkout, booking from Orders, labels, manifests, tracking updates, failed-delivery actions, return pickups), `setupSteps` (create the API user in Shiprocket; enter its email and password here; generate the webhook token and paste it in Shiprocket; add a pickup address in Shiprocket), `faq` (Why not my main login? What does it cost? Can I disconnect? What happens to parcels already booked?). Plain words, no dashes used as punctuation.
  - Coming-soon entries: title = courier name, `icon: 'Truck'`, `comingSoon: true`, `featureKeys: []`, `ctaVariant: 'connect'`, one-line description each.
  - Add `shipping` to the category lists in the three files named above so the Shipping filter can be reached the same way as the other categories.
  - `generateWebhookToken`: move the body from `app/(app)/settings/online-store/page.tsx:104`; default length 32.

- [ ] **Step 4: Run.** Same command; expected PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit** (if asked): the catalogue, token file, three category files and the test.

---

### Task 3: Provider registry and Shiprocket login check

**Files:**
- Modify: `lib/store/delivery/shiprocket.ts` (add one exported function next to `login`)
- Create: `lib/integrations/providers.ts`
- Test: `tests/lib/integrations/providers.test.ts`

**Interfaces:**
- Produces:

```ts
// lib/store/delivery/shiprocket.ts
export async function verifyShiprocketLogin(
  creds: ShiprocketCreds, opts?: { timeoutMs?: number },
): Promise<{ ok: true } | { ok: false; reason: 'rejected' | 'unreachable' }>;

// lib/integrations/providers.ts  (first line: import 'server-only' if the repo already uses that package; otherwise a comment)
export type VerifyResult = { ok: true } | { ok: false; reason: 'rejected' | 'unreachable'; message: string };
export type ProviderServer = {
  verify(input: { config: Record<string, string>; secrets: Record<string, string> }): Promise<VerifyResult>;
  countInFlight(businessId: string): Promise<number>;
  onChanged?(businessId: string): void;
  /** Extra statements inside the disconnect transaction. */
  onDisconnect?(client: PoolClient, businessId: string): Promise<void>;
};
export const PROVIDERS: Record<string, ProviderServer>;
export function getProvider(provider: string): ProviderServer | null;
```

- [ ] **Step 1: Write the failing tests** (mock `global.fetch`):

```ts
test('token in the response: ok, and nothing is cached', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ token: 't' }), { status: 200 }));
  expect(await verifyShiprocketLogin({ email: 'a@b.c', password: 'p' })).toEqual({ ok: true });
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
  expect(await verifyShiprocketLogin({ email: 'a@b.c', password: 'p' })).toEqual({ ok: false, reason: 'rejected' });
  expect(fetchMock).toHaveBeenCalledTimes(2);            // second call was not served from the token cache
});
test('4xx without a token: rejected', ...);              // status 403 → rejected
test('5xx: unreachable', ...);                           // status 503 → unreachable
test('fetch throws or times out: unreachable', async () => {
  fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
  expect(await verifyShiprocketLogin({ email: 'a@b.c', password: 'p' })).toEqual({ ok: false, reason: 'unreachable' });
});
test('registry: every catalogue plugin has a provider', () => {
  for (const e of INTEGRATION_CATALOG.filter((x) => x.plugin)) expect(getProvider(e.plugin!.provider)).not.toBeNull();
});
test('shiprocket verify maps reasons to the exact messages', ...);
// rejected → 'Shiprocket did not accept this email and password. Use the API user from Shiprocket → Settings → API, not your main login.'
// unreachable → 'Could not reach Shiprocket. Nothing was saved; try again.'
```

- [ ] **Step 2: Run.** `npx jest tests/lib/integrations/providers.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `verifyShiprocketLogin`: POST to `${BASE}/auth/login` with an `AbortController`, default `timeoutMs` 10000. It neither reads nor writes the `tokens` map.
  - `PROVIDERS.shiprocket`:
    - `verify` → `verifyShiprocketLogin({ email: config.email, password: secrets.password })`, mapped to the messages above.
    - `countInFlight` → one query:

      ```sql
      SELECT (SELECT count(*) FROM order_fulfilments
               WHERE business_id = $1 AND method = 'shiprocket'
                 AND status IN ('shipped','out_for_delivery','delivery_failed'))
           + (SELECT count(*) FROM order_returns
               WHERE business_id = $1 AND carrier_order_id IS NOT NULL
                 AND pickup_status IN ('booked','out_for_pickup','pickup_issue')) AS n
      ```
    - `onChanged` → `clearShiprocketCache()`.
    - `onDisconnect` → `UPDATE business_settings SET store_shiprocket_email = NULL, store_shiprocket_password_enc = NULL, store_shiprocket_webhook_token_hash = NULL, store_delivery_provider = CASE WHEN store_delivery_provider = 'shiprocket' THEN 'self' ELSE store_delivery_provider END WHERE business_id = $1`.

- [ ] **Step 4: Run.** Expected PASS. Also `npx jest tests/security/shiprocket-credential-cache.test.ts tests/lib/store/shiprocket-client.test.ts` still pass.

- [ ] **Step 5: Commit** (if asked).

---

### Task 4: Service

**Files:**
- Create: `lib/integrations/service.ts`
- Test: `tests/db/business-integrations.db.test.ts` (extend)

**Interfaces:**
- Consumes: `getPluginEntry`, `PluginField` (Task 2); `getProvider`, `ProviderServer`, `VerifyResult` (Task 3); `encryptPaymentSecret`, `decryptPaymentSecret`; `hashStoreWebhookToken`, `isValidShiprocketWebhookToken` from `lib/store/delivery/webhooks.ts`.
- Produces:

```ts
export type ConnectionView = {
  provider: string;
  connected: boolean;              // row exists and every required password field has a stored secret
  config: Record<string, string>;
  secretsSet: string[];
  webhookConfigured: boolean;
  lastVerifiedAt: string | null;
};
export type SaveValues = Record<string, unknown>;   // keyed by PluginField.key; webhook_token: string = set, null = clear, absent = keep
export type SaveResult =
  | { ok: true; connection: ConnectionView }
  | { ok: false; code: 'INVALID' | 'REJECTED' | 'UNREACHABLE' | 'TOKEN_TAKEN'; error: string };
export type DisconnectResult = { ok: true } | { ok: false; code: 'IN_FLIGHT'; count: number };

export async function listConnections(businessId: string): Promise<ConnectionView[]>;
export async function getConnection(businessId: string, provider: string): Promise<ConnectionView | null>;
export async function loadSecrets(businessId: string, provider: string):
  Promise<{ config: Record<string, string>; secrets: Record<string, string> } | null>;
export async function saveConnection(
  businessId: string, pluginId: string, values: SaveValues, actorUserId: string | null,
  opts?: { verify?: ProviderServer['verify'] },
): Promise<SaveResult>;
export async function setWebhookToken(
  businessId: string, provider: string, token: string | null,
): Promise<{ ok: true } | { ok: false; code: 'NOT_CONNECTED' | 'INVALID' | 'TOKEN_TAKEN'; error: string }>;
export async function disconnect(businessId: string, provider: string): Promise<DisconnectResult>;
export async function resolveBusinessForWebhookToken(provider: string, token: string): Promise<string | null>;
```

`saveConnection` follows spec section 7.1 with these pinned details:
- `pluginId` unknown or without a plugin block → `INVALID`, "Unknown integration".
- Any value that is not a string (or `null` for the webhook token), any key not in the plugin's fields, any value over 255 characters → `INVALID`.
- `text` and `email` values are trimmed; `email` must contain `@`. `password` values are stored exactly as sent. An empty or absent password keeps the stored one; if none is stored and the field is required → `INVALID`, "`<label>` is required".
- The webhook token must pass `isValidShiprocketWebhookToken`; otherwise `INVALID`, "Webhook token must be 24–128 letters or digits".
- `verify` (default: the provider's) is called with the merged values. Not ok → `REJECTED` or `UNREACHABLE` with the provider's message; no write.
- Write: `INSERT ... ON CONFLICT (business_id, provider) DO UPDATE`, setting `config`, `secrets_enc` (merged), `last_verified_at = now()`, `connected_by`, `updated_at = now()`, and `webhook_token_hash` only when a token or `null` was sent. PostgreSQL error `23505` on `uq_business_integrations_webhook_token` → `TOKEN_TAKEN`, "Generate a new webhook token".
- Then `onChanged`.

`setWebhookToken`: no row → `NOT_CONNECTED`, "Connect Shiprocket first". No credential check.

`disconnect`: one transaction on a client from `getPool()` (pattern: `lib/store/order-lifecycle.ts`). No row → `{ ok: true }`. `countInFlight > 0` → `IN_FLIGHT` with the count, no change. Otherwise delete the row, run `onDisconnect`, commit, `onChanged`.

`loadSecrets` returns null when there is no row. A secret that fails to decrypt throws (as today).

- [ ] **Step 1: Write the failing tests** in the Task 1 file. Stubs: `const accept = async () => ({ ok: true as const })`, `const reject = async () => ({ ok: false as const, reason: 'rejected' as const, message: 'nope' })`.

```ts
test('rejected credentials save nothing', async () => {
  const r = await saveConnection(A, 'shiprocket', { email: 'a@shop.test', password: 'pw' }, null, { verify: reject });
  expect(r).toEqual({ ok: false, code: 'REJECTED', error: 'nope' });
  expect(await getConnection(A, 'shiprocket')).toBeNull();
});
test('accepted credentials are stored encrypted and read back', async () => {
  const r = await saveConnection(A, 'shiprocket', { email: '  A@Shop.test ', password: ' pw with spaces ' }, USER, { verify: accept });
  expect(r.ok && r.connection).toMatchObject({ connected: true, config: { email: 'A@Shop.test' }, secretsSet: ['password'], webhookConfigured: false });
  const raw = await pool.query(`SELECT secrets_enc FROM business_integrations WHERE business_id = $1`, [A]);
  expect(raw.rows[0].secrets_enc.password).not.toContain('pw with spaces');
  expect(await loadSecrets(A, 'shiprocket')).toEqual({ config: { email: 'A@Shop.test' }, secrets: { password: ' pw with spaces ' } });   // Review Focus 1
});
test('views never carry a secret, ciphertext or hash', async () => {
  const json = JSON.stringify([await getConnection(A, 'shiprocket'), await listConnections(A)]);
  expect(json).not.toMatch(/pw with spaces|secrets_enc|webhook_token_hash/);
});
test('a blank password keeps the stored one, and the check sees the stored one', async () => {
  const verify = jest.fn(accept);
  await saveConnection(A, 'shiprocket', { email: 'new@shop.test', password: '' }, null, { verify });
  expect(verify).toHaveBeenCalledWith({ config: { email: 'new@shop.test' }, secrets: { password: ' pw with spaces ' } });
});
test('two saves at once leave one row', async () => {                                  // Review Focus 2
  await Promise.all([1, 2].map(() => saveConnection(A, 'shiprocket', { email: 'x@shop.test', password: 'p' }, null, { verify: accept })));
  expect((await pool.query(`SELECT 1 FROM business_integrations WHERE business_id = $1`, [A])).rowCount).toBe(1);
});
test.each([
  [{ email: 'a@shop.test', password: 'p', extra: 'x' }],      // unknown key
  [{ email: { a: 1 }, password: 'p' }],                        // not a string
  [{ email: 'a@shop.test', password: 'p'.repeat(256) }],       // too long
  [{ email: 'no-at-sign', password: 'p' }],
  [{ email: 'a@shop.test', password: 'p', webhook_token: 'short' }],
])('invalid input %# is refused before the check runs', async (values) => {            // Review Focus 4
  const verify = jest.fn(accept);
  expect(await saveConnection(B, 'shiprocket', values, null, { verify })).toMatchObject({ ok: false, code: 'INVALID' });
  expect(verify).not.toHaveBeenCalled();
  expect(await getConnection(B, 'shiprocket')).toBeNull();
});
test('required password missing on first connect is INVALID', ...);
test('unknown plugin id and a coming-soon id are INVALID', ...);                        // 'nope', 'delhivery'
test('webhook token: resolves to its business only; a second business cannot take it', async () => {
  await saveConnection(A, 'shiprocket', { email: 'a@shop.test', webhook_token: TOKEN }, null, { verify: accept });
  expect(await resolveBusinessForWebhookToken('shiprocket', TOKEN)).toBe(A);
  expect(await resolveBusinessForWebhookToken('shiprocket', 'x'.repeat(32))).toBeNull();
  expect(await resolveBusinessForWebhookToken('shiprocket', '')).toBeNull();
  expect(await saveConnection(B, 'shiprocket', { email: 'b@shop.test', password: 'p', webhook_token: TOKEN }, null, { verify: accept }))
    .toEqual({ ok: false, code: 'TOKEN_TAKEN', error: 'Generate a new webhook token' });
});
test('a row with a token but no password is not connected, keeps its token when credentials arrive', async () => {   // Review Focus 3
  await pool.query(`INSERT INTO business_integrations (business_id, provider, webhook_token_hash) VALUES ($1, 'shiprocket', $2)`, [C, HASH_C]);
  expect(await getConnection(C, 'shiprocket')).toMatchObject({ connected: false, webhookConfigured: true });
  expect(await loadSecrets(C, 'shiprocket')).toEqual({ config: {}, secrets: {} });
  await saveConnection(C, 'shiprocket', { email: 'c@shop.test', password: 'p' }, null, { verify: accept });
  expect(await resolveBusinessForWebhookToken('shiprocket', TOKEN_C)).toBe(C);
});
test('setWebhookToken: needs a row; null clears', ...);
test('business B never sees or changes business A', async () => {
  expect(await getConnection(B, 'shiprocket')).toBeNull();
  await disconnect(B, 'shiprocket');
  expect(await getConnection(A, 'shiprocket')).not.toBeNull();
});
test('disconnect is refused with a parcel in flight', async () => {
  // insert an order_fulfilments row for A: method 'shiprocket', status 'shipped' (columns as in tests/db/shiprocket-booking.db.test.ts)
  expect(await disconnect(A, 'shiprocket')).toEqual({ ok: false, code: 'IN_FLIGHT', count: 1 });
  expect(await getConnection(A, 'shiprocket')).not.toBeNull();
});
test('disconnect deletes the row, clears the old columns and resets the checkout provider', async () => {
  // parcel moved to 'delivered'; business_settings for A has old columns set and store_delivery_provider = 'shiprocket'
  expect(await disconnect(A, 'shiprocket')).toEqual({ ok: true });
  expect(await getConnection(A, 'shiprocket')).toBeNull();
  const s = (await pool.query(`SELECT store_shiprocket_email, store_shiprocket_password_enc, store_shiprocket_webhook_token_hash, store_delivery_provider FROM business_settings WHERE business_id = $1`, [A])).rows[0];
  expect(s).toEqual({ store_shiprocket_email: null, store_shiprocket_password_enc: null, store_shiprocket_webhook_token_hash: null, store_delivery_provider: 'self' });
  await pool.query(COPY_SQL);                                    // the copy cannot bring it back
  expect(await getConnection(A, 'shiprocket')).toBeNull();
});
test('disconnect twice, or with nothing connected, is ok', async () => {              // Review Focus 5
  expect(await disconnect(A, 'shiprocket')).toEqual({ ok: true });
});
```

`PAYMENT_ENCRYPTION_KEY` must be set for this suite; set a 64-hex test value at the top of the file if the environment has none.

- [ ] **Step 2: Run.** `npx jest tests/db/business-integrations.db.test.ts --runInBand`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lib/integrations/service.ts`** to the interfaces and rules above.

- [ ] **Step 4: Run.** Expected: all pass, none skipped.

- [ ] **Step 5: Commit** (if asked).

---

### Task 5: Point the existing readers at the service

**Files:**
- Modify: `lib/store/delivery/index.ts:112-127` (`loadShiprocketCreds`)
- Modify: `lib/store/order-lifecycle.ts:239-246` (`resolveBusinessIdForShiprocketToken`)
- Modify: `lib/fulfilment/shiprocket-booking.ts:190`, `lib/returns/pickup.ts:38-39` (help string only)
- Modify tests that seed `store_shiprocket_webhook_token_hash` on `business_settings`: `tests/db/store-order-safety.db.test.ts:235`, `tests/db/shiprocket-booking.db.test.ts:168`, `tests/db/order-return-pickup.db.test.ts:193`, `tests/db/phase3-6a-store-cancel.db.test.ts:601`
- Test: `tests/db/business-integrations.db.test.ts` (one more test)

**Interfaces:**
- Consumes: `loadSecrets`, `resolveBusinessForWebhookToken` (Task 4).
- Produces: unchanged signatures `loadShiprocketCreds(businessId): Promise<ShiprocketCreds | null>` and `resolveBusinessIdForShiprocketToken(token): Promise<string | null>`.

- [ ] **Step 1: Write the failing test.**

```ts
test('loadShiprocketCreds reads the connection, not the old columns', async () => {
  await pool.query(`UPDATE business_settings SET store_shiprocket_email = 'old@shop.test', store_shiprocket_password_enc = $2 WHERE business_id = $1`,
    [D, encryptPaymentSecret('old')]);
  expect(await loadShiprocketCreds(D)).toBeNull();
  await saveConnection(D, 'shiprocket', { email: 'new@shop.test', password: 'new' }, null, { verify: accept });
  expect(await loadShiprocketCreds(D)).toEqual({ email: 'new@shop.test', password: 'new' });
});
```

- [ ] **Step 2: Run; expect FAIL** (returns the old credentials).

- [ ] **Step 3: Implement.** `loadShiprocketCreds` returns null unless both `config.email` and `secrets.password` are present. `resolveBusinessIdForShiprocketToken` delegates to `resolveBusinessForWebhookToken('shiprocket', token)`. Replace both help strings with the Global Constraints "Not connected" copy. In the four seeding tests, insert the token hash into `business_integrations (business_id, provider, webhook_token_hash)` with `ON CONFLICT (business_id, provider) DO UPDATE` instead of into `business_settings`; add `DELETE FROM business_integrations` to their cleanup only if the business rows are not deleted (the foreign key cascades).

- [ ] **Step 4: Run the affected suites.**

```bash
npx jest tests/db/business-integrations.db.test.ts tests/db/store-order-safety.db.test.ts tests/db/shiprocket-booking.db.test.ts tests/db/order-return-pickup.db.test.ts tests/db/phase3-6a-store-cancel.db.test.ts tests/db/order-returns-api.db.test.ts tests/db/order-fulfilment.db.test.ts --runInBand
```

Expected: all pass. Any test asserting the old help string is updated to the new copy.

- [ ] **Step 5: Commit** (if asked).

---

### Task 6: Plugin API routes

**Files:**
- Create: `app/api/integrations/route.ts`, `app/api/integrations/[id]/route.ts`
- Test: `tests/security/integrations-routes.test.ts`

**Interfaces:**
- Consumes: service functions (Task 4), `getPluginEntry` (Task 2), `requireTenantPermission(request, claimedBusinessId, 'settings', action)`.
- Produces:

| Route | Permission | Success body | Failures |
|---|---|---|---|
| `GET /api/integrations?business_id=` | `['read','update']` | `{ connections: ConnectionView[] }` | |
| `GET /api/integrations/[id]?business_id=` | `['read','update']` | `{ connection: ConnectionView \| null }` | 404 unknown id or no plugin block |
| `PUT /api/integrations/[id]` body `{ business_id, values }` | `'update'` | `{ connection }` | 400 `INVALID`/`REJECTED`, 502 `UNREACHABLE`, 409 `TOKEN_TAKEN`, 404 unknown id; body `{ error, code }` |
| `DELETE /api/integrations/[id]?business_id=` | `'update'` | `{ ok: true }` | 409 `{ error, code: 'IN_FLIGHT', count }`, 404 unknown id |

`export const dynamic = 'force-dynamic'` on both. A body that is not JSON, or `values` that is not a plain object → 400. Unexpected errors → 500 `{ error: 'Could not save the integration' }` and `console.error` of the error only (never the body). In-flight message: `` `${count} parcel(s) are still with Shiprocket. Disconnect once they are delivered or returned.` ``

- [ ] **Step 1: Write the failing tests.** Mock `@/lib/security/require-tenant-permission` and `@/lib/integrations/service` (pattern: the route tests already in `tests/security/`, e.g. `branch-update-route.test.ts`).

```ts
test('PUT passes the session business and user, never the body business', async () => {
  permission.mockResolvedValue({ ok: true, businessId: 'SESSION_BIZ', userId: 'U1' });
  save.mockResolvedValue({ ok: true, connection: VIEW });
  const res = await PUT(req('PUT', { business_id: 'OTHER', values: { email: 'a@b.c', password: 'p' } }), ctx('shiprocket'));
  expect(res.status).toBe(200);
  expect(save).toHaveBeenCalledWith('SESSION_BIZ', 'shiprocket', { email: 'a@b.c', password: 'p' }, 'U1');
});
test('a refused permission is returned as is and the service is not called', ...);       // GET, PUT, DELETE
test.each([['INVALID', 400], ['REJECTED', 400], ['UNREACHABLE', 502], ['TOKEN_TAKEN', 409]])('%s → %i', ...);
test('unknown id and a coming-soon id are 404 on every method', ...);                    // 'nope', 'delhivery'
test('values that is an array, a string or missing is 400', ...);                         // Review Focus 4
test('DELETE in flight is 409 with the count', ...);
test('responses never include the request password', async () => {
  save.mockResolvedValue({ ok: false, code: 'REJECTED', error: 'nope' });
  const res = await PUT(req('PUT', { values: { email: 'a@b.c', password: 'SECRET-PW' } }), ctx('shiprocket'));
  expect(await res.text()).not.toContain('SECRET-PW');
});
```

- [ ] **Step 2: Run.** `npx jest tests/security/integrations-routes.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement both route files.**

- [ ] **Step 4: Run.** Expected PASS; `npm run typecheck`.

- [ ] **Step 5: Commit** (if asked).

---

### Task 7: Online-store settings API keeps working (phone app)

**Files:**
- Modify: `app/api/settings/online-store/route.ts` (GET columns at lines 23-28 and 118-128; PATCH at 160-174 and 297-314, 356-357)
- Test: `tests/db/business-integrations.db.test.ts` (extend) or the existing online-store route test if one covers this PATCH

**Interfaces:**
- Consumes: `getConnection`, `saveConnection`, `setWebhookToken` (Task 4).
- Produces: unchanged response fields `store_shiprocket_email`, `shiprocket_configured`, `shiprocket_webhook_configured`; unchanged request fields `store_shiprocket_email`, `store_shiprocket_password`, `store_shiprocket_webhook_token`.

Rules:
- GET: `store_shiprocket_email = connection?.config.email ?? null`, `shiprocket_configured = connection?.connected ?? false`, `shiprocket_webhook_configured = connection?.webhookConfigured ?? false`. The three SQL expressions on the old columns are removed from `SETTINGS_COLS`.
- PATCH, evaluated before the `business_settings` update:
  - Email or password present → `saveConnection(businessId, 'shiprocket', { email, password, webhook_token }, tenant.userId)`, sending `email` as the body's value or, if absent, the stored one; `webhook_token` only if the body has it. Failure → respond with the same status mapping as Task 6 and do not run the rest of the PATCH.
  - Only the webhook token present → `setWebhookToken`. `NOT_CONNECTED` → 400.
  - The old-column `sets.push` lines and the `23505` branch for `uq_business_settings_shiprocket_webhook_token` are removed.
- `store_delivery_provider = 'shiprocket'` is accepted only when the connection is connected after the step above; otherwise 400, "Connect Shiprocket under Integrations first".

- [ ] **Step 1: Write the failing tests** (call the route handlers with a mocked `requireTenantPermission` and `denyIfFeatureMissing`, real DB, `jest.mock('@/lib/integrations/providers')` so `verify` accepts or rejects):

```ts
test('GET reports the connection', ...);        // after saveConnection: email, shiprocket_configured true
test('PATCH with email + password goes through the credential check', ...);   // reject → 400, nothing stored, other fields in the same PATCH not saved
test('PATCH with only store_tagline does not call verify', ...);
test('PATCH with only a webhook token and no connection is 400', ...);
test('choosing shiprocket as the checkout provider without a connection is 400', ...);
test('the old columns are not written', async () => {
  // after a successful PATCH: business_settings.store_shiprocket_email IS NULL for that business
});
```

- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** this suite plus any existing online-store route tests (`npx jest -t "online-store"`). Expected PASS.
- [ ] **Step 5: Commit** (if asked).

---

### Task 8: Marketplace list and plugin page

**Files:**
- Modify: `hooks/useIntegrationMarketplaceStatus.ts`, `components/settings/IntegrationMarketplaceList.tsx`
- Create: `app/(app)/settings/integrations/[id]/page.tsx`, `components/settings/integrations/PluginPage.tsx`, `components/settings/integrations/PluginSettingsForm.tsx`
- Modify: `e2e/routes.json`, `lib/breadcrumb-utils.ts`, `lib/mobile-route-title.ts` (add `/settings/integrations/shiprocket` the way sibling settings routes are listed)
- Test: `tests/lib/integrations/plugin-form.test.ts`

**Interfaces:**
- Consumes: Task 6 routes; `getPluginEntry`, `generateWebhookToken` (Task 2).
- Produces (pure helpers, exported from `PluginSettingsForm.tsx` or a sibling `plugin-form.ts`, so they can be tested without rendering):

```ts
export function initialFormValues(fields: PluginField[], connection: ConnectionView | null): Record<string, string>;
// text/email ← connection.config[key] ?? ''; password and webhook_token ← ''
export function buildSaveValues(fields: PluginField[], form: Record<string, string>): Record<string, string>;
// text/email always sent (trimmed); password and webhook_token sent only when non-empty
export function cardAction(entry: IntegrationCatalogEntry, status: IntegrationRowStatus):
  { label: 'Connect' | 'Manage' | 'Coming soon' | 'Upgrade' | 'Access' | 'Try now' | 'Open'; href: string | null; disabled: boolean };
```

- [ ] **Step 1: Write the failing tests.**

```ts
test('initial values: config filled, secrets blank', () => {
  expect(initialFormValues(FIELDS, { ...VIEW, config: { email: 'a@b.c' } })).toEqual({ email: 'a@b.c', password: '', webhook_token: '' });
});
test('save values: blank password and token are left out', () => {
  expect(buildSaveValues(FIELDS, { email: ' a@b.c ', password: '', webhook_token: '' })).toEqual({ email: 'a@b.c' });
  expect(buildSaveValues(FIELDS, { email: 'a@b.c', password: ' p ', webhook_token: 'T'.repeat(32) }))
    .toEqual({ email: 'a@b.c', password: ' p ', webhook_token: 'T'.repeat(32) });
});
test('plugin card: Connect when not connected, Manage when connected, both open the plugin page', () => {
  expect(cardAction(SHIPROCKET, { active: false, entitled: true, loading: false })).toEqual({ label: 'Connect', href: '/settings/integrations/shiprocket', disabled: false });
  expect(cardAction(SHIPROCKET, { active: true, entitled: true, loading: false })).toMatchObject({ label: 'Manage', href: '/settings/integrations/shiprocket' });
});
test('non-plugin cards behave as before', () => {
  expect(cardAction(EMAIL, { active: true, entitled: true, loading: false })).toMatchObject({ label: 'Access', href: '/settings/email' });
  expect(cardAction(DELHIVERY, { active: false, entitled: false, loading: false })).toMatchObject({ label: 'Coming soon', disabled: true });
});
```

- [ ] **Step 2: Run.** `npx jest tests/lib/integrations/plugin-form.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Status hook:** one `fetch('/api/integrations?business_id=…', { credentials: 'include' })`; for an entry with a `plugin` block, `active = connections.some(c => c.provider === entry.plugin.provider && c.connected)`. WhatsApp and email logic untouched.
  - **List:** add `Truck` to `ICON_MAP`; replace the inline label/handler block with `cardAction` (existing labels and targets preserved for non-plugin entries, as the test pins).
  - **Page (`[id]/page.tsx`):** client page inside `SettingsPageShell`; `getPluginEntry(params.id)` null → `notFound()`. Renders `PluginPage`.
  - **`PluginPage`:** header (icon, title, short description, "Connected" badge, primary button), tabs Overview / Setup / FAQ / Settings (`?tab=` in the URL; "Connect" switches to Settings). Loads `GET /api/integrations/[id]`. Disconnect: confirm dialog ("Disconnect Shiprocket? Booking, labels and tracking updates stop until you connect again."), `DELETE`, show the 409 message when refused.
  - **`PluginSettingsForm`:** generated from `fields`. `password` placeholder when stored: "Saved. Type a new one to replace it." `webhook_token`: read-only webhook address `${window.location.origin}/api/webhooks/store/${provider}` with a copy button; status line ("A token is saved." / "No token yet. Tracking updates are refused until one is saved here and in Shiprocket."); "Generate token" fills the field; note "Copy this token into Shiprocket, then save. It is not shown again." Button "Save and verify" → `PUT`; success text "Connected. Shiprocket accepted these details."; failure shows `error` under the form. Keep `data-testid="shiprocket-webhook-token"` on the token input.
  - Without settings-update permission (use the same capability check other settings pages use): tabs and state visible, no form inputs enabled, no Disconnect button.
  - Follow the styling of `IntegrationMarketplaceList` and `SettingsPageShell`; works at phone width and in dark mode.

- [ ] **Step 4: Run.** Tests PASS; `npm run typecheck`; `npm run lint`.

- [ ] **Step 5: Commit** (if asked).

---

### Task 9: Online-store settings page

**Files:**
- Modify: `app/(app)/settings/online-store/page.tsx` (state at ~83-84, 104, 201-202, 313-315; block at 972-1024)
- Modify: any e2e spec that drives the removed inputs (`grep -rn "shiprocket-webhook-token\|Shiprocket email" e2e`)

**Interfaces:**
- Consumes: `shiprocket_configured` from `GET /api/settings/online-store` (Task 7).

- [ ] **Step 1: Remove** the `shipEmail`, `shipPassword`, `shipWebhookToken`, `shipWebhookConfigured` state, the local `generateWebhookToken`, the three `store_shiprocket_*` keys in the save body, and the `SetupBlock` at 972-1024.

- [ ] **Step 2: Dropdown.** The "Shiprocket" option is `disabled` unless `shiprocket_configured`. Under the row, when not configured: text "Connect Shiprocket under Integrations to use it for delivery." with a link to `/settings/integrations/shiprocket`. When configured and selected: "Connected. Manage under Integrations." with the same link. If the saved provider is `shiprocket` but the connection is gone, show the first message; the value stays selectable so the page can still save.

- [ ] **Step 3: Verify.** `npm run typecheck`; `npm run lint`; `grep -n "shipEmail\|shipPassword\|shipWebhook" "app/(app)/settings/online-store/page.tsx"` prints nothing. Update or remove e2e steps that used the removed inputs, pointing them at the plugin page.

- [ ] **Step 4: Commit** (if asked).

---

### Task 10: Docs, checklist, log

**Files:**
- Modify: `knowledge/how-to/online-store.md`, `knowledge/prospect/modules/online-store.md` (where they describe connecting Shiprocket), `docs/audits/SETTINGS_AUDIT.md` if it lists the Shiprocket fields
- Create: `docs/superpowers/plans/2026-11-12-courier-plugins-phase-1-staging-checklist.md`
- Modify: `docs/project.log.md` (append), `docs/roadmap.md` (card)

- [ ] **Step 1: Update the how-to text** to "Settings → Integrations → Shiprocket".

- [ ] **Step 2: Write the staging checklist** (owner runs it on `https://staging.khatario.com` after migration 476 and the deploy):
  1. A business that had Shiprocket before the deploy shows "Connected" on the Shiprocket card, without re-entering anything.
  2. Settings → Integrations → Shipping shows Shiprocket plus five "Coming soon" cards.
  3. Overview, Setup and FAQ tabs read correctly on a phone and in dark mode.
  4. A wrong password shows the rejection message and the card stays as it was.
  5. The correct API user saves and shows "Connected".
  6. Changing only the email with the password left blank saves.
  7. Generate a webhook token, paste it into Shiprocket, save; a tracking update on a test parcel moves the order.
  8. Book one parcel from Orders; print its label; generate a manifest.
  9. Start a return pickup on a delivered order.
  10. Online-store settings: the Shiprocket form is gone; the "Delivered by" dropdown offers Shiprocket.
  11. Disconnect with a parcel in transit is refused with a count.
  12. After the parcel is delivered, Disconnect works; the card shows "Connect"; "Delivered by" is back to "Own staff"; booking from Orders says to connect Shiprocket under Integrations.
  13. Phone app: Settings shows the Shiprocket status correctly and saving the API user there still works.
  14. A staff user without settings-update permission sees the plugin page but no form.
  15. Re-run the copy `INSERT` from migration 476; nothing changes.

- [ ] **Step 3: Full check.**

```bash
npm run typecheck
npm run lint
npx jest tests/lib/integrations tests/security/integrations-routes.test.ts tests/lib/store tests/lib/returns
npx jest tests/db --runInBand
graphify update .
```

Expected: all green; DB suites ran (not skipped).

- [ ] **Step 4: Append the project log entry** (Asked / Decided / Shipped / Open, per `docs/brain.md`) and move or add the roadmap card. State plainly: migration 476 written, not applied to staging or production; nothing verified in a browser.

- [ ] **Step 5: Commit** (if asked).
