import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Plan catalogue v2 and the WhatsApp split, end to end on a fresh business.
 *
 * - Landing shows Free / Growth / Business (+ Connect) at live prices; old plan names are gone.
 * - A new signup gets a trial with automatic reminders but without Connect features.
 * - Switching to Free removes automatic reminders but keeps manual WhatsApp sending.
 * - Connect-only screens and APIs (inbox, AI agent, shop, templates, Meta Cloud API) are locked.
 * - QR linking needs the risk acknowledgement; bulk sends over QR are capped at 15.
 * - Legacy WhatsApp add-ons can no longer be bought.
 *
 * Signs up once with E2E_PLAN_V2_PHONE (must be in the target's OTP_DEBUG_PHONES), then logs in
 * with the same password on later runs. Never clicks "Connect WhatsApp", so no QR session is made.
 *
 *   $env:PLAYWRIGHT_SKIP_WEBSERVER='1'; $env:PLAYWRIGHT_BASE_URL='https://staging.khatario.com'
 *   $env:E2E_PLAN_V2_PHONE='9999000001'; npx playwright test e2e/plan-catalog-v2.spec.ts --retries=0
 */

const PHONE = process.env.E2E_PLAN_V2_PHONE || '';
const PASSWORD = process.env.E2E_PLAN_V2_PASSWORD || 'E2E_PlanV2_test!2026';
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

type CurrentSub = {
  plan_id: string;
  is_trial: boolean;
  enabled_features: { id: string }[];
};

test.describe.configure({ mode: 'serial' });

test.describe('Plan catalogue v2 and WhatsApp split', () => {
  test.skip(!PHONE, 'Set E2E_PLAN_V2_PHONE to a number listed in OTP_DEBUG_PHONES');
  test.skip(/(^|\/\/)(www\.)?khatario\.com/.test(BASE), 'Never runs against production');

  let context: BrowserContext;
  let page: Page;

  async function currentSub(): Promise<CurrentSub> {
    const res = await page.request.get('/api/subscriptions/current?module_key=billing');
    expect(res.ok(), await res.text()).toBeTruthy();
    return ((await res.json()) as { subscription: CurrentSub }).subscription;
  }

  const featureIds = (s: CurrentSub) => new Set(s.enabled_features.map((f) => f.id));

  /** New accounts get a welcome tour dialog that would sit on top of everything else. */
  async function dismissWelcomeTour() {
    const skip = page.getByRole('button', { name: /no thanks/i });
    if (await skip.isVisible({ timeout: 3000 }).catch(() => false)) await skip.click();
  }

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('landing pricing shows the new plans at live prices', async () => {
    await page.goto('/#pricing');
    const pricing = page.locator('#pricing');
    await expect(pricing.getByRole('heading', { name: 'Growth', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(pricing.getByText('₹399', { exact: true })).toBeVisible();
    await expect(pricing.getByText('₹999', { exact: true })).toBeVisible();
    await expect(pricing.getByText('₹0', { exact: true })).toBeVisible();
    await expect(pricing).not.toContainText('Professional');
    await expect(pricing).not.toContainText('Enterprise');
    await expect(pricing).toContainText('Automatic WhatsApp payment reminders');
  });

  test('sign up a fresh business (or log back in to it)', async () => {
    const api = page.request;
    const otpRes = await api.post('/api/public/platform-otp', {
      data: { action: 'request', purpose: 'signup', phone: PHONE },
    });
    expect(otpRes.ok(), await otpRes.text()).toBeTruthy();
    const { debugOtp } = (await otpRes.json()) as { debugOtp?: string };
    expect(debugOtp, 'phone must be listed in OTP_DEBUG_PHONES on the target').toBeTruthy();

    const verifyRes = await api.post('/api/public/platform-otp', {
      data: { action: 'verify', purpose: 'signup', phone: PHONE, code: debugOtp },
    });
    expect(verifyRes.ok(), await verifyRes.text()).toBeTruthy();

    const signupRes = await api.post('/api/signup', {
      data: {
        businessName: `E2E Plan v2 ${Date.now()}`,
        businessType: 'retail',
        industry: 'services',
        userName: 'E2E Plan v2',
        userPhone: PHONE,
        password: PASSWORD,
      },
    });

    if (signupRes.status() === 409) {
      await page.goto('/login');
      await page.getByPlaceholder(/enter your phone/i).fill(PHONE);
      await page.getByRole('button', { name: /continue/i }).click();
      await page.getByPlaceholder(/enter your password/i).fill(PASSWORD);
      await page.getByRole('button', { name: /login/i }).click();
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
    } else {
      expect(signupRes.status(), await signupRes.text()).toBe(201);
    }

    const session = await api.get('/api/auth/session');
    expect(session.ok()).toBeTruthy();
    const body = (await session.json()) as { business?: { id: string; name?: string } };
    expect(body.business?.id).toBeTruthy();
    test.info().annotations.push({ type: 'business', description: `${body.business?.name} (${body.business?.id})` });
  });

  test('a trial has automatic reminders but not Connect', async () => {
    const sub = await currentSub();
    test.skip(sub.plan_id !== 'trial', `business is already on ${sub.plan_id} from an earlier run`);
    const ids = featureIds(sub);
    expect(ids.has('whatsapp_auto_reminders')).toBe(true);
    expect(ids.has('settings_whatsapp')).toBe(true);
    expect(ids.has('integration_whatsapp_bot')).toBe(false);
  });

  test('plan picker offers Free, Growth and Business only', async () => {
    const res = await page.request.get('/api/subscriptions/plans?module_key=billing');
    expect(res.ok(), await res.text()).toBeTruthy();
    const json = (await res.json()) as { plans?: { id: string }[] } | { id: string }[];
    const plans = Array.isArray(json) ? json : json.plans ?? [];
    const ids = plans.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['free', 'growth', 'business']));
    expect(ids).not.toContain('professional');
    expect(ids).not.toContain('enterprise');
  });

  test('a paid plan is not granted without payment', async () => {
    const res = await page.request.post('/api/subscriptions/upgrade', {
      data: { plan_id: 'growth', module_key: 'billing', billing_cycle: 'monthly' },
    });
    const sub = await currentSub();
    expect(sub.plan_id, `upgrade returned ${res.status()}`).not.toBe('growth');
  });

  test('switching to Free removes automatic reminders, keeps WhatsApp', async () => {
    const before = await currentSub();
    if (before.plan_id !== 'free') {
      const res = await page.request.post('/api/subscriptions/upgrade', {
        data: { plan_id: 'free', module_key: 'billing', billing_cycle: 'monthly' },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    const sub = await currentSub();
    expect(sub.plan_id).toBe('free');
    const ids = featureIds(sub);
    expect(ids.has('whatsapp_auto_reminders')).toBe(false);
    expect(ids.has('settings_whatsapp')).toBe(true);
    expect(ids.has('integration_whatsapp_bot')).toBe(false);
  });

  test('Free: reminder settings show the Growth upsell and manual sending stays', async () => {
    await page.goto('/settings/whatsapp/notifications');
    await expect(page.getByText('Automatic reminders come with the Growth plan')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'See plans' })).toBeVisible();
    await expect(page.getByRole('link', { name: /send reminders/i })).toBeVisible();

    await page.goto('/whatsapp/reminders');
    await expect(page).toHaveURL(/\/whatsapp\/reminders/);
    await expect(page).not.toHaveURL(/upsell=/);
  });

  test('QR linking needs the risk acknowledgement; Meta Cloud API is locked', async () => {
    await page.goto('/settings/whatsapp');
    const connect = page.getByRole('button', { name: /connect whatsapp/i });
    await expect(connect).toBeVisible({ timeout: 30000 });
    await expect(connect).toBeDisabled();
    await page
      .locator('label', { hasText: 'I understand this links WhatsApp as a device' })
      .locator('input[type="checkbox"]')
      .check();
    await expect(connect).toBeEnabled();
    await expect(page.getByText('The official WhatsApp Business API comes with Connect')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Get Connect' })).toBeVisible();
  });

  for (const path of ['inbox', 'ai-agent', 'shop', 'templates']) {
    test(`Connect-only screen is locked: ${path}`, async () => {
      await page.goto(`/settings/whatsapp/${path}`);
      await dismissWelcomeTour();
      const cta = page.getByRole('button', { name: 'Get Connect' }).first();
      await expect(cta).toBeVisible({ timeout: 30000 });
      await cta.click();
      await dismissWelcomeTour();
      await expect(page.getByText('₹1,499').first()).toBeVisible();
      await expect(page.getByRole('button', { name: /proceed to payment.*connect/i })).toBeVisible();
      await page.getByRole('button', { name: /maybe later/i }).click();
    });
  }

  test('Connect-only APIs refuse a business without Connect', async () => {
    const api = page.request;
    const template = await api.post('/api/settings/whatsapp-templates', {
      data: { name: 'e2e_blocked', category: 'UTILITY', body: 'Hi' },
    });
    expect(template.status()).toBe(403);
    expect(((await template.json()) as { code?: string }).code).toBe('WHATSAPP_BOT_ADDON_REQUIRED');

    const cloud = await api.put('/api/settings/whatsapp-cloud', {
      data: { waba_id: '1', phone_number_id: '2', access_token: 'x' },
    });
    expect(cloud.status()).toBe(403);
    expect(((await cloud.json()) as { code?: string }).code).toBe('WHATSAPP_BOT_ADDON_REQUIRED');
  });

  test('legacy WhatsApp add-ons are replaced by Connect', async () => {
    for (const type of ['whatsapp_bot', 'whatsapp_send_message']) {
      const res = await page.request.post(`/api/subscriptions/addons/${type}/purchase`, { data: {} });
      expect(res.status(), type).toBe(410);
      expect(((await res.json()) as { code?: string }).code).toBe('ADDON_REPLACED_BY_CONNECT');
    }
    const ai = await page.request.post('/api/subscriptions/addons/khatario_ai/purchase', { data: {} });
    expect(ai.status()).toBe(403);
    expect(((await ai.json()) as { code?: string }).code).toBe('WHATSAPP_BOT_ADDON_REQUIRED');
  });

  test('bulk reminders over QR are capped at 15 per batch', async () => {
    const ids = Array.from({ length: 16 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const res = await page.request.post('/api/whatsapp/send-bulk-reminders', {
      data: { invoice_ids: ids, message_template: 'Hi {customer_name}', include_pdf: false },
    });
    expect(res.status(), await res.text()).toBe(400);
    const body = (await res.json()) as { code?: string; max_batch?: number };
    expect(body.code).toBe('BATCH_TOO_LARGE');
    expect(body.max_batch).toBe(15);
  });
});
