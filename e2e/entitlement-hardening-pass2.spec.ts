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

async function authedPage(browser: import('@playwright/test').Browser, persona: TestPersona) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await (await import('@playwright/test')).request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);
  await api.dispose();
  return { ctx, page };
}

const BILLING_ENDPOINTS = [
  { path: '/api/invoices', label: 'invoices list' },
  { path: '/api/invoices/next-number?branch_id=00000000-0000-4000-8000-000000000001', label: 'invoice next-number' },
  { path: '/api/customers', label: 'customers list' },
  { path: '/api/items/search?q=test', label: 'items search' },
  { path: '/api/items', label: 'items list' },
  { path: '/api/purchases', label: 'purchases list' },
  { path: '/api/estimates', label: 'estimates list' },
  { path: '/api/dashboard', label: 'dashboard summary' },
  { path: '/api/dashboard/receivables', label: 'dashboard receivables' },
  { path: '/api/dashboard/recent-invoices', label: 'dashboard recent invoices' },
];

const HR_ENDPOINTS = [
  { path: '/api/employees', label: 'employees list' },
  { path: '/api/employees/attendance', label: 'attendance' },
  { path: '/api/employees/leave-requests', label: 'leave requests' },
  { path: '/api/employees/salary/payments', label: 'payroll payments' },
  { path: '/api/hr/recruitment/jobs', label: 'recruitment jobs' },
  { path: '/api/hr/dashboard/overview', label: 'hr dashboard' },
];

function withBusinessId(path: string, businessId: string) {
  const sep = path.includes('?') ? '&' : '?';
  return `${baseUrl}${path}${sep}business_id=${businessId}`;
}

test('Connect-only user cannot access Billing APIs', async ({ browser }) => {
  const persona = p('connect');
  const { ctx, page } = await authedPage(browser, persona);

  for (const ep of BILLING_ENDPOINTS) {
    const res = await page.request.get(withBusinessId(ep.path, persona.businessId));
    expect(res.status(), `${ep.label} should be 403`).toBe(403);
    const body = await res.json().catch(() => ({}));
    expect(body.code, `${ep.label} error code`).toBe('FEATURE_NOT_IN_PLAN');
  }

  await ctx.close();
});

test('Connect-only user cannot access HR APIs', async ({ browser }) => {
  const persona = p('connect');
  const { ctx, page } = await authedPage(browser, persona);

  for (const ep of HR_ENDPOINTS) {
    const res = await page.request.get(withBusinessId(ep.path, persona.businessId));
    expect(res.status(), `${ep.label} should be 403`).toBe(403);
  }

  await ctx.close();
});

test('Billing-only user cannot access HR APIs', async ({ browser }) => {
  const persona = p('billing');
  const { ctx, page } = await authedPage(browser, persona);

  for (const ep of HR_ENDPOINTS) {
    const res = await page.request.get(withBusinessId(ep.path, persona.businessId));
    expect(res.status(), `${ep.label} should be 403`).toBe(403);
  }

  await ctx.close();
});

test('HR-only user cannot access Billing APIs', async ({ browser }) => {
  const persona = p('hr');
  const { ctx, page } = await authedPage(browser, persona);

  for (const ep of BILLING_ENDPOINTS) {
    const res = await page.request.get(withBusinessId(ep.path, persona.businessId));
    expect(res.status(), `${ep.label} should be 403`).toBe(403);
  }

  await ctx.close();
});

test('Entitled users: billing persona can read billing APIs', async ({ browser }) => {
  const persona = p('billing');
  const { ctx, page } = await authedPage(browser, persona);

  const checks = [
    '/api/invoices',
    '/api/customers',
    '/api/items',
    '/api/dashboard',
    '/api/estimates',
  ];
  for (const path of checks) {
    const res = await page.request.get(withBusinessId(path, persona.businessId));
    expect(res.status(), path).toBe(200);
  }

  await ctx.close();
});

test('Entitled users: HR persona can read HR APIs', async ({ browser }) => {
  const persona = p('hr');
  const { ctx, page } = await authedPage(browser, persona);

  const checks = ['/api/employees', '/api/employees/attendance', '/api/hr/recruitment/jobs'];
  for (const path of checks) {
    const res = await page.request.get(withBusinessId(path, persona.businessId));
    expect(res.status(), path).toBe(200);
  }

  await ctx.close();
});

test('Browser: Connect user blocked from /invoices and /employees UI', async ({ browser }) => {
  const persona = p('connect');
  const { ctx, page } = await authedPage(browser, persona);

  await page.goto(`${baseUrl}/invoices`);
  await page.waitForURL(/upsell=billing|settings\/products/, { timeout: 20000 });
  expect(page.url()).toMatch(/upsell=billing|settings\/products/);
  await page.screenshot({
    path: 'e2e/evidence/pass2-connect-billing-blocked.png',
    fullPage: true,
  });

  await page.goto(`${baseUrl}/employees`);
  await page.waitForURL(/upsell=hr|settings\/products/, { timeout: 20000 });
  expect(page.url()).toMatch(/upsell=hr|settings\/products/);
  await page.screenshot({
    path: 'e2e/evidence/pass2-connect-hr-blocked.png',
    fullPage: true,
  });

  await ctx.close();
});
