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
  upsertPlanLimit,
  withDbClient,
} from './helpers/db';
import {
  ENFORCED_LIMIT_TYPES,
  loadPlanRegistryCatalog,
} from './helpers/plan-registry-catalog';
import { LIMIT_KEY_BY_TYPE } from '../lib/subscription/limit-registry';
import { LIMIT_OWNER_MODULE } from '../lib/subscription/module-entitlements';

test.describe.configure({ mode: 'serial' });

let baseUrl = '';
let persona: TestPersona | null = null;
let cleanup: (() => Promise<void>) | null = null;
let planId = '';

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

test('registry catalog: lists all admin plan limits and features', async () => {
  const catalog = await loadPlanRegistryCatalog();
  expect(catalog.limits.length).toBeGreaterThanOrEqual(28);
  expect(catalog.features.length).toBeGreaterThanOrEqual(60);
  expect(catalog.planIds.length).toBeGreaterThan(0);

  const enforcedKeys = new Set(ENFORCED_LIMIT_TYPES.map((t) => LIMIT_KEY_BY_TYPE[t]));
  const withoutCheck = catalog.limits.filter((l) => !enforcedKeys.has(l.limit_key));
  // Document-only limit (no check-limit API yet)
  expect(withoutCheck.map((l) => l.limit_key)).toEqual([
    'max_leave_requests_per_employee_per_year',
  ]);
});

test('every enforced limit type matches admin effective value on user plan', async ({
  browser,
  playwright,
}) => {
  if (!persona) throw new Error('persona missing');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const mismatches: string[] = [];
  const billingLimitTypes = ENFORCED_LIMIT_TYPES.filter((t) => {
    const owner = LIMIT_OWNER_MODULE[t];
    return !owner || owner === 'billing';
  });

  for (const limitType of billingLimitTypes) {
    const limitKey = LIMIT_KEY_BY_TYPE[limitType];
    const expected = await getEffectivePlanLimit(planId, limitKey);

    const res = await page.request.get(
      `${baseUrl}/api/subscriptions/check-limit?business_id=${persona.businessId}&limit_type=${limitType}`,
    );
    expect(res.status(), `${limitType} check-limit status`).toBe(200);
    const body = await res.json();

    if (expected != null && body.limit !== expected) {
      mismatches.push(`${limitType}: api=${body.limit} admin=${expected}`);
    }
    expect(typeof body.current).toBe('number');
    expect(typeof body.allowed).toBe('boolean');
  }

  expect(mismatches, 'check-limit must match admin plan limits').toEqual([]);

  await api.dispose();
  await ctx.close();
});

test('admin limit change propagates to all enforced limit types (spot: customers)', async ({
  browser,
  playwright,
}) => {
  if (!persona) throw new Error('persona missing');

  const original = await getEffectivePlanLimit(planId, 'max_customers');
  const testValue = 23;
  await upsertPlanLimit(planId, 'max_customers', testValue);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.get(
    `${baseUrl}/api/subscriptions/check-limit?business_id=${persona.businessId}&limit_type=customers`,
  );
  expect((await res.json()).limit).toBe(testValue);

  if (original != null) {
    await upsertPlanLimit(planId, 'max_customers', original);
  } else {
    await withDbClient(async (c) => {
      await c.query(
        `DELETE FROM subscription_plan_limits WHERE plan_id = $1 AND limit_key = $2`,
        [planId, 'max_customers'],
      );
    });
  }

  await api.dispose();
  await ctx.close();
});

test('plan enabled_features from API align with subscription_plan_features registry', async ({
  browser,
  playwright,
}) => {
  if (!persona) throw new Error('persona missing');

  const registryIds = await withDbClient(async (c) => {
    const r = await c.query<{ feature_id: string }>(
      `SELECT feature_id FROM subscription_plan_features
       WHERE plan_id = $1 AND enabled = true`,
      [planId],
    );
    return new Set(r.rows.map((x) => x.feature_id));
  });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, persona);

  const res = await page.request.get(
    `${baseUrl}/api/subscriptions/current?business_id=${persona.businessId}`,
  );
  expect(res.status()).toBe(200);
  const body = await res.json();
  const enabled = (body.subscription?.enabled_features ?? []) as { id: string }[];

  for (const f of enabled) {
    expect(registryIds.has(f.id), `enabled_features includes ${f.id}`).toBe(true);
  }

  await api.dispose();
  await ctx.close();
});
