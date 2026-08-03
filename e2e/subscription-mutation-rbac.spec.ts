import { test, expect } from '@playwright/test';
import { discoverBaseUrl } from './helpers/discover-base-url';
import { hasDbConfig } from './helpers/db';
import {
  loginPersonaApi,
  provisionRbacBusiness,
  type RbacPersona,
  type RbacPersonaKind,
} from './helpers/subscription-rbac-personas';

test.describe.configure({ mode: 'serial' });

let baseUrl = '';
let personas: RbacPersona[] = [];
let businessId = '';
let cleanup: (() => Promise<void>) | null = null;

const MUTATION_ENDPOINTS = [
  {
    name: 'checkout',
    method: 'POST' as const,
    path: '/api/subscriptions/checkout',
    body: (bid: string) => ({
      business_id: bid,
      plan_id: 'free',
      billing_cycle: 'monthly',
    }),
  },
  {
    name: 'upgrade',
    method: 'POST' as const,
    path: '/api/subscriptions/upgrade',
    body: (bid: string) => ({
      business_id: bid,
      plan_id: 'free',
      module_key: 'billing',
      billing_cycle: 'monthly',
    }),
  },
  {
    name: 'downgrade',
    method: 'POST' as const,
    path: '/api/subscriptions/downgrade',
    body: (bid: string) => ({
      business_id: bid,
      target_plan_id: 'free',
      module_key: 'billing',
    }),
  },
  {
    name: 'addon purchase',
    method: 'POST' as const,
    path: '/api/subscriptions/addons/whatsapp_bot/purchase',
    body: (bid: string) => ({ business_id: bid }),
  },
];

test.beforeAll(async ({ request }) => {
  test.skip(!hasDbConfig(), 'Postgres required');
  baseUrl = await discoverBaseUrl();
  const bundle = await provisionRbacBusiness(request, baseUrl);
  personas = bundle.personas;
  businessId = bundle.owner.businessId;
  cleanup = bundle.cleanup;
});

test.afterAll(async () => {
  if (cleanup) await cleanup();
});

function p(kind: RbacPersonaKind) {
  const row = personas.find((x) => x.kind === kind);
  if (!row) throw new Error(`missing persona ${kind}`);
  return row;
}

async function callMutation(
  api: import('@playwright/test').APIRequestContext,
  ep: (typeof MUTATION_ENDPOINTS)[number],
) {
  const url = `${baseUrl}${ep.path}`;
  const data = ep.body(businessId);
  if (ep.method === 'POST') {
    return api.post(url, { data });
  }
  return api.fetch(url, { method: ep.method, data });
}

for (const kind of ['owner', 'admin'] as RbacPersonaKind[]) {
  test(`${kind} can call subscription mutations`, async ({ playwright }) => {
    const persona = p(kind);
    const api = await playwright.request.newContext();
    await loginPersonaApi(api, baseUrl, persona);

    for (const ep of MUTATION_ENDPOINTS) {
      const res = await callMutation(api, ep);
      expect(res.status(), `${kind} ${ep.name}`).not.toBe(403);
    }

    await api.dispose();
  });
}

for (const kind of ['employee', 'readonly'] as RbacPersonaKind[]) {
  test(`${kind} cannot call subscription mutations (403 FORBIDDEN)`, async ({
    playwright,
  }) => {
    const persona = p(kind);
    const api = await playwright.request.newContext();
    await loginPersonaApi(api, baseUrl, persona);

    for (const ep of MUTATION_ENDPOINTS) {
      const res = await callMutation(api, ep);
      expect(res.status(), `${kind} ${ep.name}`).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('FORBIDDEN');
    }

    await api.dispose();
  });
}

test('employee cannot POST /api/modules', async ({ playwright }) => {
  const persona = p('employee');
  const api = await playwright.request.newContext();
  await loginPersonaApi(api, baseUrl, persona);

  const res = await api.post(`${baseUrl}/api/modules`, {
    data: { business_id: businessId, module_key: 'connect' },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe('FORBIDDEN');

  await api.dispose();
});

test('owner browser: subscription settings reachable', async ({ browser, playwright }) => {
  const persona = p('owner');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await loginPersonaApi(api, baseUrl, persona);
  const state = await api.storageState();
  await page.context().addCookies(state.cookies);

  await page.goto(`${baseUrl}/settings/subscription`);
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: 'e2e/evidence/rbac-owner-subscription-settings.png',
    fullPage: true,
  });
  expect(page.url()).toContain('/settings/subscription');

  await api.dispose();
  await ctx.close();
});

test('employee browser: blocked from mutating via upgrade API', async ({ playwright }) => {
  const persona = p('employee');
  const api = await playwright.request.newContext();
  await loginPersonaApi(api, baseUrl, persona);

  const res = await api.post(`${baseUrl}/api/subscriptions/upgrade`, {
    data: {
      business_id: businessId,
      plan_id: 'free',
      module_key: 'billing',
      billing_cycle: 'monthly',
    },
  });
  expect(res.status()).toBe(403);

  await api.dispose();
});
