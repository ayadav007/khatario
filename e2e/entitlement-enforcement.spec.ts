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

test('POST /api/modules returns 403 MODULE_REQUIRES_CHECKOUT', async ({
  browser,
  playwright,
}) => {
  const persona = p('hr');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.post(`${baseUrl}/api/modules`, {
    data: { module_key: 'connect', business_id: persona.businessId },
  });
  const body = await res.json();
  expect(res.status()).toBe(403);
  expect(body.code).toBe('MODULE_REQUIRES_CHECKOUT');
  expect(body.plan_id).toBe('connect');

  await api.dispose();
  await ctx.close();
});

test('Connect-only user GET /api/invoices returns 403', async ({
  browser,
  playwright,
}) => {
  const persona = p('connect');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.get(
    `${baseUrl}/api/invoices?business_id=${persona.businessId}`,
  );
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.code).toBe('FEATURE_NOT_IN_PLAN');

  await api.dispose();
  await ctx.close();
});

test('Billing user GET /api/invoices returns 200', async ({
  browser,
  playwright,
}) => {
  const persona = p('billing');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.get(
    `${baseUrl}/api/invoices?business_id=${persona.businessId}`,
  );
  expect(res.status()).toBe(200);

  await api.dispose();
  await ctx.close();
});

test('POST /api/subscriptions/current returns 403 for tenants', async ({
  browser,
  playwright,
}) => {
  const persona = p('hr');
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
  const body = await res.json();
  expect(body.code).toBe('SUBSCRIPTION_ASSIGNMENT_FORBIDDEN');

  await api.dispose();
  await ctx.close();
});

test('Manipulated module POST with invalid module_key fails', async ({
  browser,
  playwright,
}) => {
  const persona = p('hr');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.post(`${baseUrl}/api/modules`, {
    data: { module_key: 'not_a_module', business_id: persona.businessId },
  });
  expect(res.status()).toBe(400);

  await api.dispose();
  await ctx.close();
});

test('Upgrade API enables module after entitlement (billing on HR user)', async ({
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
      payment_method: 'e2e',
    },
  });
  if (!upgrade.ok()) {
    const errBody = await upgrade.json().catch(() => ({}));
    throw new Error(`upgrade failed ${upgrade.status()}: ${JSON.stringify(errBody)}`);
  }

  const invoices = await page.request.get(
    `${baseUrl}/api/invoices?business_id=${persona.businessId}`,
  );
  expect(invoices.status()).toBe(200);

  await api.dispose();
  await ctx.close();
});
