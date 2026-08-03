import { test, expect } from '@playwright/test';
import { discoverBaseUrl } from './helpers/discover-base-url';
import {
  provisionPersonas,
  seedPersonaSession,
  type TestPersona,
} from './helpers/subscription-personas';
import { hasDbConfig } from './helpers/db';

test.describe.configure({ mode: 'serial' });

let baseUrl = '';
let personas: TestPersona[] = [];
let cleanup: (() => Promise<void>) | null = null;

test.beforeAll(async ({ request }) => {
  test.skip(!hasDbConfig(), 'Postgres required');
  baseUrl = await discoverBaseUrl();
  const bundle = await provisionPersonas(request, baseUrl);
  personas = bundle.personas;
  cleanup = bundle.cleanup;
});

test.afterAll(async () => {
  if (cleanup) await cleanup();
});

function p(kind: TestPersona['kind']) {
  const row = personas.find((x) => x.kind === kind);
  if (!row) throw new Error(`missing persona ${kind}`);
  return row;
}

test('Cannot activate paid plan via upgrade API', async ({ browser, playwright }) => {
  const persona = p('hr');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.post(`${baseUrl}/api/subscriptions/upgrade`, {
    data: {
      business_id: persona.businessId,
      plan_id: 'business',
      module_key: 'billing',
      billing_cycle: 'monthly',
      payment_method: 'forged',
    },
  });

  expect([402, 503]).toContain(res.status());
  const body = await res.json();
  expect(['REQUIRES_CHECKOUT', 'PAYMENT_NOT_CONFIGURED']).toContain(body.code);

  await api.dispose();
  await ctx.close();
});

test('Cannot activate module via POST /api/modules', async ({ browser, playwright }) => {
  const persona = p('hr');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.post(`${baseUrl}/api/modules`, {
    data: { business_id: persona.businessId, module_key: 'connect' },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe('MODULE_REQUIRES_CHECKOUT');

  await api.dispose();
  await ctx.close();
});

test('Cannot assign subscription via POST /api/subscriptions/current', async ({
  browser,
  playwright,
}) => {
  const persona = p('billing');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.post(`${baseUrl}/api/subscriptions/current`, {
    data: {
      business_id: persona.businessId,
      plan_id: 'enterprise',
      status: 'active',
    },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe('SUBSCRIPTION_ASSIGNMENT_FORBIDDEN');

  await api.dispose();
  await ctx.close();
});

test('Fake platform webhook rejected without valid signature', async ({ request }) => {
  const raw = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_fake', notes: { business_id: 'x' } } } },
  });
  const res = await request.post(`${baseUrl}/api/webhooks/platform-billing/razorpay`, {
    data: raw,
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': 'invalid_signature_hex',
    },
  });
  expect([401, 503]).toContain(res.status());
});

test('Approved free plan upgrade succeeds without webhook', async ({
  browser,
  playwright,
}) => {
  const persona = p('hr');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const upgrade = await page.request.post(`${baseUrl}/api/subscriptions/upgrade`, {
    data: {
      business_id: persona.businessId,
      plan_id: 'free',
      module_key: 'billing',
      billing_cycle: 'monthly',
      payment_method: 'e2e_free',
    },
  });
  expect(upgrade.ok()).toBeTruthy();

  const invoices = await page.request.get(
    `${baseUrl}/api/invoices?business_id=${persona.businessId}`,
  );
  expect(invoices.status()).toBe(200);

  await api.dispose();
  await ctx.close();
});
