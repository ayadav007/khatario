import { test, expect, type APIRequestContext } from '@playwright/test';
import { discoverBaseUrl } from './helpers/discover-base-url';
import { hasDbConfig, insertMinimalCustomer, insertMinimalServiceItem } from './helpers/db';
import {
  loginPersonaApi,
  provisionRbacBusiness,
  type RbacPersona,
} from './helpers/subscription-rbac-personas';

/**
 * Offline catalog sync APIs must authenticate from the signed session cookies only.
 * The client-set `khatario_local_session` hint cookie and query user_id/business_id
 * must never establish identity.
 */

test.describe.configure({ mode: 'serial' });

const LOCAL_SESSION = 'khatario_local_session';
const ACCESS = 'khatario_session';
const REFRESH = 'khatario_refresh';
const CATALOGS = ['customers', 'items'] as const;

let baseUrl = '';
let owner: RbacPersona;
let readonly: RbacPersona;
let foreignOwner: RbacPersona;
const tag = `ocb${Date.now()}`;
const homeNames = { customers: `${tag} Home Customer`, items: `${tag} Home Item` };
const foreignNames = { customers: `${tag} Foreign Customer`, items: `${tag} Foreign Item` };
const cleanups: Array<() => Promise<void>> = [];

test.beforeAll(async ({ request }) => {
  test.skip(!hasDbConfig(), 'Postgres required');
  baseUrl = await discoverBaseUrl();

  const home = await provisionRbacBusiness(request, baseUrl);
  cleanups.push(home.cleanup);
  owner = home.owner;
  const ro = home.personas.find((p) => p.kind === 'readonly');
  if (!ro) throw new Error('missing readonly persona');
  readonly = ro;

  const foreign = await provisionRbacBusiness(request, baseUrl);
  cleanups.push(foreign.cleanup);
  foreignOwner = foreign.owner;

  await insertMinimalCustomer(owner.businessId, homeNames.customers, '29');
  await insertMinimalServiceItem(owner.businessId, homeNames.items, 100, 18);
  await insertMinimalCustomer(foreignOwner.businessId, foreignNames.customers, '29');
  await insertMinimalServiceItem(foreignOwner.businessId, foreignNames.items, 100, 18);
});

test.afterAll(async () => {
  for (const fn of cleanups) await fn();
});

function catalogUrl(kind: (typeof CATALOGS)[number], params: Record<string, string | undefined>) {
  const qs = new URLSearchParams({ page: '1', limit: '500' });
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return `${baseUrl}/api/offline-sync/catalog/${kind}?${qs}`;
}

function rowNames(kind: (typeof CATALOGS)[number], body: Record<string, unknown>): string[] {
  const rows = (body[kind] as Array<{ name?: string }> | undefined) ?? [];
  return rows.map((r) => String(r.name ?? ''));
}

async function getJson(api: APIRequestContext, url: string, headers?: Record<string, string>) {
  const res = await api.get(url, { headers });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status(), body };
}

async function sessionCookies(playwright: import('@playwright/test').PlaywrightWorkerArgs['playwright'], persona: RbacPersona) {
  const api = await playwright.request.newContext();
  await loginPersonaApi(api, baseUrl, persona);
  const { cookies } = await api.storageState();
  await api.dispose();
  return cookies;
}

async function contextWithCookies(
  playwright: import('@playwright/test').PlaywrightWorkerArgs['playwright'],
  cookies: Array<{ name: string; value: string }>,
) {
  const url = new URL(baseUrl);
  return playwright.request.newContext({
    storageState: {
      cookies: cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: url.hostname,
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
      })),
      origins: [],
    },
  });
}

test('1. fake local-session cookie + real user/business ids: 401, no data', async ({ playwright }) => {
  const api = await contextWithCookies(playwright, [{ name: LOCAL_SESSION, value: '1' }]);
  try {
    for (const kind of CATALOGS) {
      const { status, body } = await getJson(
        api,
        catalogUrl(kind, { user_id: owner.userId, business_id: owner.businessId }),
        {
          'x-authenticated-user-id': owner.userId,
          'x-authenticated-business-id': owner.businessId,
          'x-offline-catalog-session': '1',
          'x-user-id': owner.userId,
          'x-business-id': owner.businessId,
        },
      );
      expect(status, `${kind}: ${JSON.stringify(body).slice(0, 200)}`).toBe(401);
      expect(body.code).toBe('UNAUTHENTICATED');
      expect(body[kind]).toBeUndefined();
    }
  } finally {
    await api.dispose();
  }
});

test('1b. local-session cookie + forged/invalid JWT cookie: 401, no data', async ({ playwright }) => {
  const api = await contextWithCookies(playwright, [
    { name: LOCAL_SESSION, value: '1' },
    { name: ACCESS, value: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.forged' },
    { name: REFRESH, value: 'eyJhbGciOiJIUzI1NiJ9.eyJ0eXBlIjoicmVmcmVzaCJ9.forged' },
  ]);
  try {
    for (const kind of CATALOGS) {
      const { status, body } = await getJson(
        api,
        catalogUrl(kind, { user_id: owner.userId, business_id: owner.businessId }),
      );
      expect(status, kind).toBe(401);
      expect(body[kind]).toBeUndefined();
    }
  } finally {
    await api.dispose();
  }
});

test('2. authenticated user cannot borrow another user identity via user_id', async ({ playwright }) => {
  // Read-only user (no items/customers permission) claims the owner's user_id: evaluated as read-only -> 403.
  const roApi = await contextWithCookies(playwright, [
    ...(await sessionCookies(playwright, readonly)),
    { name: LOCAL_SESSION, value: '1' },
  ]);
  try {
    for (const kind of CATALOGS) {
      const { status, body } = await getJson(
        roApi,
        catalogUrl(kind, { user_id: owner.userId, userId: owner.userId, business_id: owner.businessId }),
        { 'x-user-id': owner.userId },
      );
      expect(status, `${kind}: ${JSON.stringify(body).slice(0, 200)}`).toBe(403);
      expect(body[kind]).toBeUndefined();
    }
  } finally {
    await roApi.dispose();
  }

  // Owner claims the read-only user's id: still evaluated as owner -> 200.
  const ownerApi = await contextWithCookies(playwright, await sessionCookies(playwright, owner));
  try {
    for (const kind of CATALOGS) {
      const { status, body } = await getJson(
        ownerApi,
        catalogUrl(kind, { user_id: readonly.userId, business_id: owner.businessId }),
      );
      expect(status, kind).toBe(200);
      expect(rowNames(kind, body)).toContain(homeNames[kind]);
    }
  } finally {
    await ownerApi.dispose();
  }
});

test('3. authenticated user cannot request another business catalog', async ({ playwright }) => {
  const api = await contextWithCookies(playwright, [
    ...(await sessionCookies(playwright, owner)),
    { name: LOCAL_SESSION, value: '1' },
  ]);
  try {
    for (const kind of CATALOGS) {
      const { status, body } = await getJson(
        api,
        catalogUrl(kind, { user_id: owner.userId, business_id: foreignOwner.businessId }),
        { 'x-business-id': foreignOwner.businessId },
      );
      expect(status, `${kind}: ${JSON.stringify(body).slice(0, 200)}`).toBe(403);
      expect(body[kind]).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(foreignNames[kind]);
    }
  } finally {
    await api.dispose();
  }
});

test('4. legitimate offline client (session cookies + local hint) can sync its catalog', async ({ browser, playwright }) => {
  const cookies = await sessionCookies(playwright, owner);
  const ctx = await browser.newContext();
  await ctx.addCookies([
    ...cookies,
    { name: LOCAL_SESSION, value: '1', url: baseUrl },
  ]);
  const page = await ctx.newPage();
  try {
    await page.goto(`${baseUrl}/login`);
    // Same request shape as lib/offline/catalog/sync/catalog-sync.ts.
    for (const kind of CATALOGS) {
      const result = await page.evaluate(
        async ({ kind, businessId, userId }) => {
          const res = await fetch(
            `/api/offline-sync/catalog/${kind}?business_id=${encodeURIComponent(businessId)}` +
              `&user_id=${encodeURIComponent(userId)}&page=1&limit=500`,
            { credentials: 'include' },
          );
          return { status: res.status, body: await res.json() };
        },
        { kind, businessId: owner.businessId, userId: owner.userId },
      );
      expect(result.status, kind).toBe(200);
      const names = rowNames(kind, result.body);
      expect(names).toContain(homeNames[kind]);
      expect(names).not.toContain(foreignNames[kind]);
    }
  } finally {
    await ctx.close();
  }
});

test('4b. expired access token with valid refresh token still syncs (middleware rotation)', async ({ playwright }) => {
  const cookies = (await sessionCookies(playwright, owner)).filter((c) => c.name !== ACCESS);
  expect(cookies.some((c) => c.name === REFRESH)).toBe(true);
  const api = await contextWithCookies(playwright, [...cookies, { name: LOCAL_SESSION, value: '1' }]);
  try {
    for (const kind of CATALOGS) {
      const { status, body } = await getJson(
        api,
        catalogUrl(kind, { user_id: owner.userId, business_id: owner.businessId }),
      );
      expect(status, kind).toBe(200);
      expect(rowNames(kind, body)).toContain(homeNames[kind]);
    }
  } finally {
    await api.dispose();
  }
});

test('5. verified token identity cannot be overridden by query user/business', async ({ playwright }) => {
  const api = await contextWithCookies(playwright, [
    ...(await sessionCookies(playwright, owner)),
    { name: LOCAL_SESSION, value: '1' },
  ]);
  try {
    for (const kind of CATALOGS) {
      const mismatch = await getJson(
        api,
        catalogUrl(kind, { user_id: foreignOwner.userId, business_id: foreignOwner.businessId }),
      );
      expect(mismatch.status, kind).toBe(403);
      expect(JSON.stringify(mismatch.body)).not.toContain(foreignNames[kind]);

      const userOnly = await getJson(api, catalogUrl(kind, { user_id: foreignOwner.userId }));
      expect(userOnly.status, kind).toBe(200);
      const names = rowNames(kind, userOnly.body);
      expect(names).toContain(homeNames[kind]);
      expect(names).not.toContain(foreignNames[kind]);
    }
  } finally {
    await api.dispose();
  }
});
