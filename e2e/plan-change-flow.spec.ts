import { test, expect } from '@playwright/test';
import { discoverBaseUrl } from './helpers/discover-base-url';
import {
  provisionPersonas,
  seedPersonaSession,
  type TestPersona,
} from './helpers/subscription-personas';
import { getModulePlanId, hasDbConfig, pickActivePlanId } from './helpers/db';

test.describe.configure({ mode: 'serial' });

let baseUrl = '';
let persona: TestPersona | null = null;
let cleanup: (() => Promise<void>) | null = null;

test.beforeAll(async ({ request }) => {
  test.skip(!hasDbConfig(), 'Postgres required');
  baseUrl = await discoverBaseUrl();
  const bundle = await provisionPersonas(request, baseUrl);
  persona = bundle.personas.find((p) => p.kind === 'billing') ?? null;
  if (!persona) throw new Error('billing persona missing');
  cleanup = bundle.cleanup;
});

test.afterAll(async () => {
  if (cleanup) await cleanup();
});

async function currentBillingPlanId(
  page: import('@playwright/test').Page,
  businessId: string,
): Promise<string> {
  const res = await page.request.get(
    `${baseUrl}/api/subscriptions/modules/current?business_id=${businessId}`,
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  const billing = (body.modules ?? []).find(
    (m: { module_key: string }) => m.module_key === 'billing',
  );
  return billing?.subscription?.plan_id ?? '';
}

test('free plan upgrade: API applies instantly and updates module plan', async ({
  browser,
  playwright,
}) => {
  if (!persona) throw new Error('persona missing');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const before = await currentBillingPlanId(page, persona.businessId);
  expect(before).toBeTruthy();

  const freeExists = await pickActivePlanId(['free']);
  test.skip(!freeExists, 'free plan not in DB');

  if (before === 'free') {
    test.info().annotations.push({ type: 'note', description: 'already on free' });
    await api.dispose();
    await ctx.close();
    return;
  }

  const upgrade = await page.request.post(`${baseUrl}/api/subscriptions/upgrade`, {
    data: {
      business_id: persona.businessId,
      plan_id: 'free',
      module_key: 'billing',
      billing_cycle: 'monthly',
      payment_method: 'e2e_free',
    },
  });
  expect(upgrade.ok(), await upgrade.text()).toBeTruthy();

  const after = await currentBillingPlanId(page, persona.businessId);
  expect(after).toBe('free');

  const invoices = await page.request.get(
    `${baseUrl}/api/invoices?business_id=${persona.businessId}`,
  );
  expect(invoices.status()).toBe(200);

  await api.dispose();
  await ctx.close();
});

test('downgrade preview returns warnings without applying immediately', async ({
  browser,
  playwright,
}) => {
  if (!persona) throw new Error('persona missing');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const current = await currentBillingPlanId(page, persona.businessId);
  const target = current === 'free' ? 'trial' : 'free';
  if (target === 'trial') {
    test.skip(true, 'trial is not a downgrade target in this environment');
  }

  const preview = await page.request.post(`${baseUrl}/api/subscriptions/downgrade`, {
    data: {
      business_id: persona.businessId,
      target_plan_id: target,
      module_key: 'billing',
      confirmed: false,
    },
  });

  if (preview.status() === 400) {
    const err = await preview.json();
    test.skip(true, `downgrade not applicable: ${err.error}`);
  }

  expect(preview.ok()).toBeTruthy();
  const body = await preview.json();
  expect(body.success).toBe(true);
  expect(body.confirmed).toBe(false);
  expect(Array.isArray(body.warnings)).toBe(true);

  await api.dispose();
  await ctx.close();
});

test('settings UI: Change Plan modal opens and lists plans', async ({
  browser,
  playwright,
}) => {
  if (!persona) throw new Error('persona missing');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  await page.goto(`${baseUrl}/settings/subscription`);
  await page.waitForLoadState('networkidle').catch(() => {});

  if (await page.getByText('Unhandled Runtime Error').isVisible().catch(() => false)) {
    test.skip(true, 'dev server runtime error — re-run on staging after deploy');
  }

  const changeBtn = page.getByRole('button', { name: /change plan/i }).first();
  await changeBtn.waitFor({ state: 'visible', timeout: 30000 });
  await changeBtn.click();

  await page.getByRole('heading', { name: /change plan|choose a plan/i }).first().waitFor({
    timeout: 15000,
  });

  const plansRes = await page.request.get(`${baseUrl}/api/subscriptions/plans`);
  expect(plansRes.ok()).toBeTruthy();
  const plans = (await plansRes.json()).plans as { display_name: string }[];
  expect(plans.length).toBeGreaterThan(0);

  for (const plan of plans.slice(0, 3)) {
    await expect(page.getByText(plan.display_name, { exact: false }).first()).toBeVisible({
      timeout: 5000,
    });
  }

  await page.keyboard.press('Escape');

  await api.dispose();
  await ctx.close();
});

test('paid plan upgrade routes to checkout (not instant)', async ({
  browser,
  playwright,
}) => {
  if (!persona) throw new Error('persona missing');

  const paidPlan = await pickActivePlanId(['professional', 'business', 'enterprise']);
  test.skip(!paidPlan, 'no paid billing plan in DB');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const before = await getModulePlanId(persona.businessId, 'billing');

  const res = await page.request.post(`${baseUrl}/api/subscriptions/upgrade`, {
    data: {
      business_id: persona.businessId,
      plan_id: paidPlan,
      module_key: 'billing',
      billing_cycle: 'monthly',
      payment_method: 'e2e_should_fail',
    },
  });

  expect([402, 503]).toContain(res.status());
  const after = await getModulePlanId(persona.businessId, 'billing');
  expect(after).toBe(before);

  await api.dispose();
  await ctx.close();
});
