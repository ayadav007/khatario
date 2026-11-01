/**
 * Order returns release 1, end to end on staging: the customer asks for a return from the store
 * account, the shop approves it with a courier pickup, the pickup arrives (simulated Shiprocket
 * webhook), the shop receives the goods and refunds to the original payment.
 *
 * WRITTEN, NOT RUN. Run it on staging only, after migration 460 is applied and the code is deployed
 * (docs/superpowers/plans/2026-11-01-order-returns-staging-checklist.md):
 *
 *   PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test e2e/store-returns.spec.ts --project=chromium
 *
 * Needs, in `.env` or the environment (names only; never commit values):
 *   E2E_TEST_PHONE, E2E_TEST_PASSWORD   the shop owner's staging login (the E2E store keys)
 *   E2E_STORE_ORIGIN                    the test store's staging address, e.g. https://<shop>.staging.khatario.com
 *   E2E_STORE_CUSTOMER_PHONE            the customer's 10-digit phone on a delivered, online-paid (Razorpay test mode) order
 *   E2E_STORE_ORDER_NUMBER              that order's number, as shown in "Your orders"
 *   E2E_STORE_SHIPROCKET_TOKEN          the shop's Shiprocket webhook token (x-api-key) used to post the tracking events
 *   E2E_STORE_CUSTOMER_OTP              optional; the sign-in code when the store does not show a "Dev code"
 * The shop must have Shiprocket connected and at least one returnable line on that order that has not been returned.
 * Skips itself unless every variable is set and every address is on staging (never production).
 */
import { config } from 'dotenv';
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { loginAsTestUser } from './fixtures/auth';

config({ path: '.env.local' });
config({ path: '.env' });

const STAGING_ORIGIN = 'https://staging.khatario.com';
const STAGING_HOST = 'staging.khatario.com';

const storeOrigin = (process.env.E2E_STORE_ORIGIN || '').replace(/\/$/, '');
const customerPhone = (process.env.E2E_STORE_CUSTOMER_PHONE || '').replace(/\D/g, '').slice(-10);
const orderNumber = process.env.E2E_STORE_ORDER_NUMBER || '';
const webhookToken = process.env.E2E_STORE_SHIPROCKET_TOKEN || '';
const customerOtp = process.env.E2E_STORE_CUSTOMER_OTP || '';

function onStaging(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === STAGING_HOST || host.endsWith(`.${STAGING_HOST}`);
  } catch {
    return false;
  }
}

function configBlock(): string | null {
  if (!process.env.E2E_TEST_PHONE || !process.env.E2E_TEST_PASSWORD) return 'BLOCKED: set E2E_TEST_PHONE and E2E_TEST_PASSWORD';
  if (!storeOrigin || !customerPhone || !orderNumber || !webhookToken) {
    return 'BLOCKED: set E2E_STORE_ORIGIN, E2E_STORE_CUSTOMER_PHONE, E2E_STORE_ORDER_NUMBER and E2E_STORE_SHIPROCKET_TOKEN';
  }
  if (!onStaging(storeOrigin)) return 'BLOCKED: E2E_STORE_ORIGIN is not on staging.khatario.com';
  return null;
}

test.describe.configure({ mode: 'serial', retries: 0 });

let shop: BrowserContext;
let shopPage: Page;
let customer: BrowserContext;
let customerPage: Page;
let returnNumber = '';
let returnId = '';
let awb = '';

const gate = configBlock();

test.beforeAll(async ({ browser }) => {
  if (gate) return;
  shop = await browser.newContext({ baseURL: STAGING_ORIGIN, viewport: { width: 1440, height: 900 } });
  shopPage = await shop.newPage();
  customer = await browser.newContext({ baseURL: storeOrigin, viewport: { width: 420, height: 900 } });
  customerPage = await customer.newPage();
});

test.afterAll(async () => {
  await shop?.close();
  await customer?.close();
});

test.beforeEach(() => {
  test.skip(Boolean(gate), gate || undefined);
});

/** The return the shop sees, through its own session (never an id typed by hand). */
async function loadReturn(api: APIRequestContext, id: string) {
  const res = await api.get(`/api/returns/${id}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.return as {
    status: string;
    method: string | null;
    pickup_status: string | null;
    awb: string | null;
    gateway_refund?: { status?: string } | null;
  };
}

test('customer asks for a return from the store account', async () => {
  test.setTimeout(120_000);
  await customerPage.goto('/account', { waitUntil: 'domcontentloaded' });
  await customerPage.getByPlaceholder(/10-digit mobile/i).fill(customerPhone);
  await customerPage.getByRole('button', { name: /send code|continue|get code/i }).click();
  await customerPage.getByRole('textbox').first().waitFor({ state: 'visible' });

  let code = customerOtp;
  if (!code) {
    const dev = await customerPage.getByText(/Dev code:/i).textContent({ timeout: 10_000 }).catch(() => null);
    code = dev?.replace(/\D/g, '') ?? '';
  }
  test.skip(code.length !== 6, 'BLOCKED: no sign-in code (set E2E_STORE_CUSTOMER_OTP)');
  const boxes = customerPage.locator('input[maxlength="1"]');
  for (let i = 0; i < 6; i += 1) await boxes.nth(i).fill(code[i]);

  const card = customerPage.locator('li', { hasText: orderNumber }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: /return items/i }).click();

  // The not-returnable line (if the order has one) is greyed and cannot be chosen.
  const quantities = card.getByLabel(/^Quantity of /);
  expect(await quantities.count()).toBeGreaterThan(0);
  await quantities.first().selectOption('1');
  await card.getByLabel('Reason for return').selectOption({ index: 1 });
  await card.getByRole('button', { name: /request return/i }).click();

  const done = card.getByText(/Return RET-\d+.* requested/i);
  await expect(done).toBeVisible({ timeout: 30_000 });
  returnNumber = (await done.textContent())?.match(/RET-\d+/)?.[0] ?? '';
  expect(returnNumber).toMatch(/^RET-\d+$/);
  await expect(card.getByText(/Waiting for the shop/i)).toBeVisible();
});

test('the shop approves it with a courier pickup', async () => {
  test.setTimeout(180_000);
  await loginAsTestUser(shopPage);

  const list = await shop.request.get('/api/returns?status=requested');
  expect(list.ok()).toBeTruthy();
  const rows = (await list.json()).returns as Array<{ id: string; return_number: string }>;
  const row = rows.find((r) => r.return_number === returnNumber);
  expect(row, `return ${returnNumber} in the shop's requested list`).toBeTruthy();
  returnId = row!.id;

  await shopPage.goto(`/orders?view=returns&return=${returnId}`, { waitUntil: 'domcontentloaded' });
  const drawer = shopPage.getByLabel('Return details');
  await expect(drawer.getByText(returnNumber).first()).toBeVisible({ timeout: 60_000 });

  // Shiprocket connected: Courier pickup is the preselected way, with the address and PIN filled in.
  await drawer.getByRole('button', { name: /^approve$/i }).click();
  await expect(drawer.getByText('Pickup booked').first()).toBeVisible({ timeout: 90_000 });

  const r = await loadReturn(shop.request, returnId);
  expect(r.status).toBe('approved');
  expect(r.method).toBe('courier_pickup');
  expect(r.pickup_status).toBe('booked');
  expect(r.awb).toBeTruthy();
  awb = r.awb!;
});

test('the customer sees the approval and the pickup', async () => {
  await customerPage.goto('/account', { waitUntil: 'domcontentloaded' });
  const card = customerPage.locator('li', { hasText: orderNumber }).first();
  await expect(card.getByText(/Approved/).first()).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText('Picked up')).toBeVisible();
  await expect(card.getByRole('link', { name: /track/i }).first()).toBeVisible();
});

test('Shiprocket tracking reaches the return, not the store order', async () => {
  test.setTimeout(120_000);
  const hook = `${STAGING_ORIGIN}/api/webhooks/store/shiprocket`;
  const headers = { 'x-api-key': webhookToken, 'content-type': 'application/json' };
  for (const label of ['OUT FOR PICKUP', 'IN TRANSIT', 'DELIVERED']) {
    const res = await shop.request.post(hook, { headers, data: { awb, current_status: label, is_return: 1 } });
    expect(res.ok(), `webhook ${label}`).toBeTruthy();
  }
  const r = await loadReturn(shop.request, returnId);
  expect(r.pickup_status).toBe('arrived');
  expect(r.status).toBe('approved');

  await shopPage.goto(`/orders?view=returns&return=${returnId}`, { waitUntil: 'domcontentloaded' });
  await expect(shopPage.getByText('Arrived at shop, check the items')).toBeVisible({ timeout: 60_000 });
});

test('the shop receives the goods and refunds to the original payment', async () => {
  test.setTimeout(240_000);
  const drawer = shopPage.getByLabel('Return details');
  await expect(drawer.getByText(/Back to original payment/i).first()).toBeVisible();
  await drawer.getByRole('button', { name: /receive & post credit note/i }).click();

  // Razorpay may answer at once or leave the refund pending until its notice or "Check now".
  await expect(drawer.getByText(/Refunded .* to the original payment|Refund on its way/i).first()).toBeVisible({ timeout: 90_000 });

  const deadline = Date.now() + 120_000;
  let r = await loadReturn(shop.request, returnId);
  while (r.status !== 'closed' && Date.now() < deadline) {
    const check = drawer.getByRole('button', { name: /check now/i });
    if (await check.isVisible().catch(() => false)) await check.click();
    await shopPage.waitForTimeout(5_000);
    r = await loadReturn(shop.request, returnId);
  }
  expect(r.status).toBe('closed');
  expect(r.gateway_refund?.status).toBe('processed');
});

test('the customer sees the return as refunded', async () => {
  await customerPage.goto('/account', { waitUntil: 'domcontentloaded' });
  const card = customerPage.locator('li', { hasText: orderNumber }).first();
  await expect(card.getByText(/Completed/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText('Refunded').first()).toBeVisible();
});
