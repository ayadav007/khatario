import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { discoverBaseUrl } from './helpers/discover-base-url';
import { createEvidenceCollector } from './helpers/evidence';
import {
  getEnabledModules,
  loginPersona,
  provisionPersonas,
  seedPersonaSession,
  type TestPersona,
} from './helpers/subscription-personas';
import { hasDbConfig } from './helpers/db';

test.describe.configure({ mode: 'serial' });

let baseUrl = '';
let personas: TestPersona[] = [];
let cleanupPersonas: (() => Promise<void>) | null = null;
const evidence = createEvidenceCollector();

async function dismissOnboarding(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: /no thanks|skip|close tour/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await page.waitForTimeout(500);
  }
}

async function visibleMainText(page: Page): Promise<string> {
  return page.locator('main, [role="main"], body').first().innerText().catch(() => '');
}

async function upsellBannerText(page: Page): Promise<string> {
  const banner = page.locator('[class*="amber"]').first();
  if (await banner.isVisible().catch(() => false)) {
    return banner.innerText();
  }
  return visibleMainText(page);
}

async function apiSnippet(res: { status: () => number; text: () => Promise<string> }) {
  const t = await res.text();
  try {
    const j = JSON.parse(t);
    return JSON.stringify(j).slice(0, 400);
  } catch {
    return t.slice(0, 400);
  }
}

test.beforeAll(async ({ request }) => {
  test.skip(!hasDbConfig(), 'Postgres required for persona provisioning');
  baseUrl = await discoverBaseUrl();
  const bundle = await provisionPersonas(request, baseUrl);
  personas = bundle.personas;
  cleanupPersonas = bundle.cleanup;
});

test.afterAll(async () => {
  if (cleanupPersonas) await cleanupPersonas();
  evidence.writeReports(baseUrl);
});

function persona(kind: TestPersona['kind']): TestPersona {
  const p = personas.find((x) => x.kind === kind);
  if (!p) throw new Error(`Missing persona: ${kind}`);
  return p;
}

test('0 — Login works for all personas', async ({ browser }) => {
  for (const p of personas) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginPersona(page, baseUrl, p);
    const url = page.url();
    await evidence.capture(page, {
      id: 'login',
      title: `Login: ${p.kind}`,
      persona: p.kind,
      screenshotLabel: `login-${p.kind}`,
      userAction: `Login with phone ${p.phone}`,
      result: `Landed on ${url}`,
      pricingVisible: false,
      ctaText: '',
      checkoutReached: false,
      apiFindings: [],
      notes: [],
      passed: url.includes('/login') === false,
      urlVisited: `${baseUrl}/login`,
      finalUrl: url,
      modalOrBannerText: await visibleMainText(page),
    });
    expect(url).not.toContain('/login');
    await ctx.close();
  }
});

test('A — HR user attempts Billing access', async ({ browser, playwright }) => {
  const p = persona('hr');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, p);

  const target = `${baseUrl}/invoices`;
  await page.goto(target);
  await page.waitForURL(/\/settings\/products/, { timeout: 20000 });
  await page.getByText(/that area needs billing/i).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await dismissOnboarding(page);
  await page.waitForTimeout(1000);

  const banner = await upsellBannerText(page);
  const pricingVisible = /₹|\/month|pricing|plan/i.test(banner);
  const addBtn = page.getByRole('button', { name: /add billing/i });
  const ctaText = (await addBtn.textContent().catch(() => '')) || '';

  await evidence.capture(page, {
    id: 'A1',
    title: 'HR → Billing: route guard upsell',
    persona: 'hr',
    screenshotLabel: 'hr-billing-upsell',
    userAction: 'Navigate to /invoices',
    result: `Redirected to ${page.url()}`,
    pricingVisible,
    ctaText,
    checkoutReached: false,
    apiFindings: [],
    notes: pricingVisible ? [] : ['No pricing on upsell banner'],
    passed: page.url().includes('upsell=billing'),
    urlVisited: target,
    finalUrl: page.url(),
    modalOrBannerText: banner,
  });

  expect(page.url()).toContain('upsell=billing');

  const apiBefore = await page.request.get(`${baseUrl}/api/invoices?business_id=${p.businessId}`);
  const apiFindings = [
    {
      label: 'GET /api/invoices (HR-only, authenticated)',
      status: apiBefore.status(),
      bodySnippet: await apiSnippet(apiBefore),
    },
  ];

  let checkoutReached = false;
  if (await addBtn.isVisible().catch(() => false)) {
    await addBtn.click();
    await page.waitForTimeout(2500);
    const modules = await getEnabledModules(p.businessId);
    checkoutReached = page.url().includes('razorpay') || page.url().includes('checkout');

    await evidence.capture(page, {
      id: 'A2',
      title: 'HR → Billing: click Add Billing',
      persona: 'hr',
      screenshotLabel: 'hr-billing-after-add',
      userAction: 'Click "Add Billing" on upsell banner',
      result: `Modules now: ${modules.join(', ')}; URL ${page.url()}`,
      pricingVisible: false,
      ctaText,
      checkoutReached,
      apiFindings,
      notes: checkoutReached
        ? []
        : ['Billing enabled via POST /api/modules without Razorpay checkout — revenue leak'],
      passed: modules.includes('billing'),
      modalOrBannerText: await visibleMainText(page),
    });
  }

  await api.dispose();
  await ctx.close();
});

test('B — Billing user attempts HR access', async ({ browser, playwright }) => {
  const p = persona('billing');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, p);

  const target = `${baseUrl}/employees`;
  await page.goto(target);
  await page.waitForURL(/\/settings\/products/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const banner = await upsellBannerText(page);
  const addBtn = page.getByRole('button', { name: /add hr/i });
  const ctaText = (await addBtn.textContent().catch(() => '')) || '';

  const apiEmployees = await page.request.get(
    `${baseUrl}/api/employees?business_id=${p.businessId}`,
  );

  await evidence.capture(page, {
    id: 'B1',
    title: 'Billing → HR: route guard upsell',
    persona: 'billing',
    screenshotLabel: 'billing-hr-upsell',
    userAction: 'Navigate to /employees',
    result: `Redirected to ${page.url()}`,
    pricingVisible: /₹|\/month/i.test(banner),
    ctaText,
    checkoutReached: false,
    apiFindings: [
      {
        label: 'GET /api/employees (billing-only)',
        status: apiEmployees.status(),
        bodySnippet: await apiSnippet(apiEmployees),
      },
    ],
    notes: [],
    passed: page.url().includes('upsell=hr'),
    urlVisited: target,
    finalUrl: page.url(),
    modalOrBannerText: banner,
  });

  expect(page.url()).toContain('upsell=hr');
  await api.dispose();
  await ctx.close();
});

test('C — Billing user attempts Connect access', async ({ browser, playwright }) => {
  const p = persona('billing');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, p);

  const target = `${baseUrl}/whatsapp/dashboard`;
  await page.goto(target);
  await page.waitForURL(/\/settings\/products/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const banner = await upsellBannerText(page);

  const addonsRes = await page.request.get(
    `${baseUrl}/api/subscriptions/addons?business_id=${p.businessId}`,
  );

  await evidence.capture(page, {
    id: 'C1',
    title: 'Billing → Connect: route guard upsell',
    persona: 'billing',
    screenshotLabel: 'billing-connect-upsell',
    userAction: 'Navigate to /whatsapp/dashboard',
    result: `Redirected to ${page.url()}`,
    pricingVisible: /₹|\/month/i.test(banner),
    ctaText: (await page.getByRole('button', { name: /add connect/i }).textContent().catch(() => '')) || '',
    checkoutReached: false,
    apiFindings: [
      {
        label: 'GET /api/subscriptions/addons (billing-only, authenticated)',
        status: addonsRes.status(),
        bodySnippet: await apiSnippet(addonsRes),
      },
    ],
    notes: [],
    passed: page.url().includes('upsell=connect'),
    urlVisited: target,
    finalUrl: page.url(),
    modalOrBannerText: banner,
  });

  expect(page.url()).toContain('upsell=connect');
  await api.dispose();
  await ctx.close();
});

test('D — Connect user attempts Billing access', async ({ browser, playwright }) => {
  const p = persona('connect');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, p);

  const target = `${baseUrl}/invoices`;
  await page.goto(target);
  await page.waitForURL(/\/settings\/products/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const banner = await upsellBannerText(page);

  const invoicesRes = await page.request.get(
    `${baseUrl}/api/invoices?business_id=${p.businessId}`,
  );

  await evidence.capture(page, {
    id: 'D1',
    title: 'Connect → Billing: route guard upsell',
    persona: 'connect',
    screenshotLabel: 'connect-billing-upsell',
    userAction: 'Navigate to /invoices',
    result: `Redirected to ${page.url()}`,
    pricingVisible: /₹|\/month/i.test(banner),
    ctaText: (await page.getByRole('button', { name: /add billing/i }).textContent().catch(() => '')) || '',
    checkoutReached: false,
    apiFindings: [
      {
        label: 'GET /api/invoices (connect-only, authenticated)',
        status: invoicesRes.status(),
        bodySnippet: await apiSnippet(invoicesRes),
      },
    ],
    notes: invoicesRes.status() === 403 ? ['Billing API correctly blocked (403)'] : ['API leak: invoices returned without billing module'],
    passed: page.url().includes('upsell=billing') && invoicesRes.status() === 403,
    urlVisited: target,
    finalUrl: page.url(),
    modalOrBannerText: banner,
  });

  expect(page.url()).toContain('upsell=billing');
  expect(invoicesRes.status()).toBe(403);
  await api.dispose();
  await ctx.close();
});

test('E — Revenue leakage: API attacks (authenticated)', async ({ browser, playwright }) => {
  const p = persona('hr');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginPersona(page, baseUrl, p);

  const storage = await page.context().storageState();
  const authedRequest = await playwright.request.newContext({ storageState: storage });

  const planAssign = await authedRequest.post(`${baseUrl}/api/subscriptions/current`, {
    data: {
      business_id: p.businessId,
      plan_id: 'enterprise',
      status: 'active',
    },
  });

  const moduleAdd = await authedRequest.post(`${baseUrl}/api/modules`, {
    data: { business_id: p.businessId, module_key: 'connect' },
  });
  const moduleAddBody = await moduleAdd.json().catch(() => ({}));

  const addonPurchase = await authedRequest.post(
    `${baseUrl}/api/subscriptions/addons/whatsapp_bot/purchase`,
    { data: { business_id: p.businessId } },
  );
  const addonBody = await addonPurchase.json().catch(() => ({}));

  await page.goto(`${baseUrl}/connect/whatsapp`);
  await page.waitForTimeout(2000);

  await evidence.capture(page, {
    id: 'E1',
    title: 'Revenue leakage: API + direct URL',
    persona: 'hr',
    screenshotLabel: 'leakage-connect-url',
    userAction: 'POST current plan=enterprise; POST modules connect; POST addon purchase; visit /connect/whatsapp',
    result: `Plan assign ${planAssign.status()}; module ${moduleAdd.status()} (${moduleAddBody.code ?? 'n/a'}); addon ${addonPurchase.status()}; URL=${page.url()}`,
    pricingVisible: false,
    ctaText: '',
    checkoutReached: Boolean(addonBody.checkoutUrl),
    apiFindings: [
      { label: 'POST /api/subscriptions/current (enterprise)', status: planAssign.status(), bodySnippet: await apiSnippet(planAssign) },
      { label: 'POST /api/modules (connect)', status: moduleAdd.status(), bodySnippet: JSON.stringify(moduleAddBody).slice(0, 400) },
      { label: 'POST /api/subscriptions/addons/whatsapp_bot/purchase', status: addonPurchase.status(), bodySnippet: JSON.stringify(addonBody).slice(0, 400) },
    ],
    notes: [
      planAssign.ok() ? 'CRITICAL: tenant can assign paid plan without payment' : 'Plan assign blocked (403 SUBSCRIPTION_ASSIGNMENT_FORBIDDEN)',
      moduleAdd.status() === 403 && moduleAddBody.code === 'MODULE_REQUIRES_CHECKOUT'
        ? 'Module add correctly requires checkout'
        : 'Module add may bypass payment',
      addonBody.mode === 'redirect' ? 'Addon correctly requires checkout' : addonPurchase.status() === 503 ? 'Addon blocked when payments not configured' : 'Addon may activate without payment',
    ],
    passed:
      moduleAdd.status() === 403 &&
      moduleAddBody.code === 'MODULE_REQUIRES_CHECKOUT' &&
      planAssign.status() === 403,
    urlVisited: `${baseUrl}/connect/whatsapp`,
    modalOrBannerText: await visibleMainText(page),
  });

  await authedRequest.dispose();
  await ctx.close();
});

test('F — Multi-product user: subscription settings & plan modal', async ({ browser, playwright }) => {
  const p = persona('multi');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const api = await playwright.request.newContext();
  await seedPersonaSession(page, api, baseUrl, p);

  await page.goto(`${baseUrl}/settings/subscription`);
  await page.waitForTimeout(2000);
  const subText = await visibleMainText(page);

  await evidence.capture(page, {
    id: 'F1',
    title: 'Multi-product: subscription settings',
    persona: 'multi',
    screenshotLabel: 'multi-subscription-settings',
    userAction: 'Open /settings/subscription',
    result: `Modules: ${(await getEnabledModules(p.businessId)).join(', ')}`,
    pricingVisible: /₹|\/month|yearly/i.test(subText),
    ctaText: '',
    checkoutReached: false,
    apiFindings: [],
    notes: [],
    passed: subText.length > 100,
    urlVisited: `${baseUrl}/settings/subscription`,
    modalOrBannerText: subText.slice(0, 1500),
  });

  await api.dispose();
  await ctx.close();
});
