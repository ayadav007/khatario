import { test, expect, type Page } from '@playwright/test';
import { discoverBaseUrl } from './helpers/discover-base-url';
import { hasDbConfig, insertMinimalCustomer, withDbClient } from './helpers/db';
import {
  loginPersonaApi,
  provisionRbacBusiness,
  type RbacPersona,
} from './helpers/subscription-rbac-personas';

/**
 * Middleware identity boundary: browser -> middleware -> session identity -> route -> DB.
 * Client-supplied identity headers/body/query must never become the persisted actor.
 */

test.describe.configure({ mode: 'serial' });

let baseUrl = '';
let userA: RbacPersona;
let userB: RbacPersona;
let foreignOwner: RbacPersona;
let customerId = '';
const cleanups: Array<() => Promise<void>> = [];

test.beforeAll(async ({ request }) => {
  test.skip(!hasDbConfig(), 'Postgres required');
  baseUrl = await discoverBaseUrl();

  const home = await provisionRbacBusiness(request, baseUrl);
  cleanups.push(home.cleanup);
  userA = home.owner;
  const peer = home.personas.find((p) => p.kind === 'admin');
  if (!peer) throw new Error('missing admin persona');
  userB = peer;

  const foreign = await provisionRbacBusiness(request, baseUrl);
  cleanups.push(foreign.cleanup);
  foreignOwner = foreign.owner;

  customerId = await insertMinimalCustomer(userA.businessId, 'Identity Boundary Customer', '29');
});

test.afterAll(async () => {
  for (const fn of cleanups) await fn();
});

function spoofHeaders(user: RbacPersona) {
  return {
    'x-authenticated-user-id': user.userId,
    'x-authenticated-business-id': user.businessId,
    'x-authenticated-session-version': '999',
    'x-user-id': user.userId,
    'x-business-id': user.businessId,
  };
}

function spoofBody(user: RbacPersona, marker: string) {
  return {
    type: 'receivable',
    customer_id: customerId,
    amount: 1,
    payment_mode: 'cash',
    notes: marker,
    created_by: user.userId,
    user_id: user.userId,
    userId: user.userId,
    business_id: user.businessId,
  };
}

async function paymentsByMarker(marker: string) {
  return withDbClient(async (c) => {
    const r = await c.query<{ id: string; created_by: string | null; business_id: string }>(
      `SELECT id, created_by, business_id FROM payments WHERE notes = $1`,
      [marker],
    );
    return r.rows;
  });
}

async function activityActors(paymentId: string) {
  return withDbClient(async (c) => {
    const r = await c.query<{ user_id: string | null; business_id: string | null }>(
      `SELECT user_id, business_id FROM activity_logs WHERE entity_id::text = $1`,
      [paymentId],
    );
    return r.rows;
  });
}

async function browserSessionAs(persona: RbacPersona, browser: import('@playwright/test').Browser, playwright: import('@playwright/test').PlaywrightWorkerArgs['playwright']) {
  const api = await playwright.request.newContext();
  await loginPersonaApi(api, baseUrl, persona);
  const state = await api.storageState();
  await api.dispose();
  const ctx = await browser.newContext();
  await ctx.addCookies(state.cookies);
  const page: Page = await ctx.newPage();
  return { ctx, page };
}

const SPOOF_TARGETS = [
  { label: 'peer user in same business', target: () => userB },
  { label: 'owner of another business', target: () => foreignOwner },
];

for (const { label, target } of SPOOF_TARGETS) {
  test(`authenticated A spoofing ${label}: payment persisted as A`, async ({ browser, playwright }) => {
    const spoofed = target();
    const { ctx, page } = await browserSessionAs(userA, browser, playwright);
    try {
      const marker = `identity-boundary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const qs = new URLSearchParams({
        user_id: spoofed.userId,
        userId: spoofed.userId,
        business_id: spoofed.businessId,
      });

      const res = await page.request.post(`${baseUrl}/api/payments?${qs}`, {
        headers: spoofHeaders(spoofed),
        data: spoofBody(spoofed, marker),
      });
      const body = await res.json().catch(() => ({}));
      expect(res.status(), JSON.stringify(body)).toBeGreaterThanOrEqual(200);
      expect(res.status(), JSON.stringify(body)).toBeLessThan(300);

      const rows = await paymentsByMarker(marker);
      expect(rows).toHaveLength(1);
      expect(rows[0].created_by).toBe(userA.userId);
      expect(rows[0].created_by).not.toBe(spoofed.userId);
      expect(rows[0].business_id).toBe(userA.businessId);

      const actors = await activityActors(rows[0].id);
      for (const a of actors) {
        expect(a.user_id).toBe(userA.userId);
        if (a.business_id) expect(a.business_id).toBe(userA.businessId);
      }

      console.log(
        `[identity-boundary] spoof=${label} expected=${userA.userId} persisted=${rows[0].created_by} ` +
          `business=${rows[0].business_id} activity_rows=${actors.length}`,
      );
    } finally {
      await ctx.close();
    }
  });
}

test('no session + spoofed identity headers: rejected by middleware, nothing persisted', async ({ playwright }) => {
  const api = await playwright.request.newContext();
  try {
    const marker = `identity-boundary-anon-${Date.now()}`;
    const res = await api.post(`${baseUrl}/api/payments?user_id=${userB.userId}`, {
      headers: spoofHeaders(userB),
      data: spoofBody(userB, marker),
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHENTICATED');
    expect(await paymentsByMarker(marker)).toHaveLength(0);
    console.log(`[identity-boundary] anonymous spoof status=${res.status()} code=${body.code}`);
  } finally {
    await api.dispose();
  }
});
