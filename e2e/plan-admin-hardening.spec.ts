import { test, expect } from '@playwright/test';
import { discoverBaseUrl } from './helpers/discover-base-url';
import {
  provisionPersonas,
  seedPersonaSession,
  type TestPersona,
} from './helpers/subscription-personas';
import {
  getEffectivePlanLimit,
  getModulePlanId,
  hasDbConfig,
  setPlanFeatureEnabled,
  upsertPlanLimit,
  withDbClient,
} from './helpers/db';

test.describe.configure({ mode: 'serial' });

let baseUrl = '';
let persona: TestPersona | null = null;
let cleanup: (() => Promise<void>) | null = null;
let planId = '';
const TEST_LIMIT = 17;
const LIMIT_KEY = 'max_customers';
const FEATURE_ID = 'dead_stock_widget';

test.beforeAll(async ({ request }) => {
  test.skip(!hasDbConfig(), 'Postgres required');
  baseUrl = await discoverBaseUrl();
  const bundle = await provisionPersonas(request, baseUrl);
  persona = bundle.personas.find((p) => p.kind === 'billing') ?? null;
  if (!persona) throw new Error('billing persona missing');
  cleanup = bundle.cleanup;

  const pid = await getModulePlanId(persona.businessId, 'billing');
  if (!pid) throw new Error('billing module plan_id missing');
  planId = pid;
});

test.afterAll(async () => {
  if (cleanup) await cleanup();
});

test('admin plan limit override is enforced via check-limit API', async ({
  browser,
  playwright,
}) => {
  if (!persona) throw new Error('persona missing');

  const originalLimit = await getEffectivePlanLimit(planId, LIMIT_KEY);
  await upsertPlanLimit(planId, LIMIT_KEY, TEST_LIMIT);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.get(
    `${baseUrl}/api/subscriptions/check-limit?business_id=${persona.businessId}&limit_type=customers`,
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.limit, 'check-limit should reflect admin plan override').toBe(TEST_LIMIT);

  const currentRes = await page.request.get(
    `${baseUrl}/api/subscriptions/current?business_id=${persona.businessId}`,
  );
  expect(currentRes.status()).toBe(200);
  const current = await currentRes.json();
  expect(current.subscription?.features?.limits?.max_customers).toBe(TEST_LIMIT);

  if (originalLimit != null) {
    await upsertPlanLimit(planId, LIMIT_KEY, originalLimit);
  } else {
    await withDbClient(async (c) => {
      await c.query(
        `DELETE FROM subscription_plan_limits WHERE plan_id = $1 AND limit_key = $2`,
        [planId, LIMIT_KEY],
      );
    });
  }

  await api.dispose();
  await ctx.close();
});

test('admin plan feature toggle blocks gated API', async ({ browser, playwright }) => {
  if (!persona) throw new Error('persona missing');

  const wasEnabled = await withDbClient(async (c) => {
    const r = await c.query<{ enabled: boolean }>(
      `SELECT COALESCE(spf.enabled, false) AS enabled
       FROM platform_features pf
       LEFT JOIN subscription_plan_features spf
         ON spf.feature_id = pf.id AND spf.plan_id = $1
       WHERE pf.id = $2`,
      [planId, FEATURE_ID],
    );
    return r.rows[0]?.enabled ?? false;
  });

  await setPlanFeatureEnabled(planId, FEATURE_ID, false);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.get(
    `${baseUrl}/api/dashboard/dead-stock?business_id=${persona.businessId}`,
  );
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.code).toBe('FEATURE_NOT_IN_PLAN');

  await setPlanFeatureEnabled(planId, FEATURE_ID, wasEnabled);

  await api.dispose();
  await ctx.close();
});

test('current subscription API returns labeled enabled_features from plan registry', async ({
  browser,
  playwright,
}) => {
  if (!persona) throw new Error('persona missing');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.get(
    `${baseUrl}/api/subscriptions/current?business_id=${persona.businessId}`,
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  const features = body.subscription?.enabled_features as
    | { id: string; label: string; category: string }[]
    | undefined;

  if (features && features.length > 0) {
    for (const f of features) {
      expect(f.label?.trim().length, `feature ${f.id} should have label`).toBeGreaterThan(0);
      expect(f.id, 'label should not equal raw id slug').not.toBe(f.label);
    }
  }

  await api.dispose();
  await ctx.close();
});
