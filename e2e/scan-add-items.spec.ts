/**
 * Scan & Add Items in a real browser. Run through tests/live/scan-add-e2e.mjs, which starts Next on
 * kh_phase2_test, creates business A (with one item that has a known barcode) and business B, and
 * passes their logins and barcodes in the environment. Stock and ledger rows are checked by the
 * runner after this file finishes.
 */
import { test, expect, type Page } from '@playwright/test';

const need = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is required (run tests/live/scan-add-e2e.mjs)`);
  return v;
};

const A = { phone: need('E2E_TEST_PHONE'), password: need('E2E_TEST_PASSWORD') };
const B = { phone: need('SCAN_E2E_PHONE_B'), password: need('SCAN_E2E_PASSWORD_B') };
const KNOWN = need('SCAN_E2E_KNOWN_BARCODE');
const KNOWN_NAME = need('SCAN_E2E_KNOWN_NAME');
const UNKNOWN = need('SCAN_E2E_UNKNOWN_BARCODE');
const RETRY = need('SCAN_E2E_RETRY_BARCODE');
const DRAFT = need('SCAN_E2E_DRAFT_BARCODE');
const HARPIC = '8901396151005';
const TAG = need('SCAN_E2E_TAG');

async function login(page: Page, who: { phone: string; password: string }) {
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByPlaceholder(/enter your phone/i).waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((el) => /continue/i.test(el.textContent || ''));
    return !!button && Object.keys(button).some((key) => key.startsWith('__react'));
  }, undefined, { timeout: 120000 });
  await page.getByPlaceholder(/enter your phone/i).fill(who.phone);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByPlaceholder(/enter your password/i).fill(who.password);
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90000 });
}

/** Signs out but keeps this browser's localStorage, as a shared shop phone or PC would. */
async function logout(page: Page) {
  await page.request.post('/api/auth/logout');
  await page.context().clearCookies();
}

/** The input under a form label (the Input component does not link label and input). */
const field = (page: Page, label: string) => page.locator(`div.w-full:has(> label:text-is("${label}")) input`).first();

async function openScanAdd(page: Page) {
  // No wait for the plan snapshot: since app/(app)/layout.tsx always renders AccessibilityProvider,
  // its arrival no longer remounts the page, and these tests act as soon as the page responds.
  await page.goto('/items/scan-add');
  await expect(page.getByRole('heading', { name: 'Scan & Add Items' })).toBeVisible({ timeout: 60000 });
  // The heading is server-rendered; wait until React has wired up the buttons, as the login helper does.
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((el) => /Scan barcode|Continue/.test(el.textContent || ''));
    return !!button && Object.keys(button).some((key) => key.startsWith('__react'));
  }, undefined, { timeout: 120000 });
}

async function typeBarcode(page: Page, code: string) {
  await page.getByLabel('Barcode').fill(code);
  await page.getByRole('button', { name: 'Check' }).click();
}

/** From the photo steps to the form without photos. */
async function typeDetailsInstead(page: Page) {
  await expect(page.getByRole('button', { name: 'Type details instead' })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Type details instead' }).click();
  await expect(page.getByText('New product')).toBeVisible();
}

test.describe.configure({ mode: 'serial', timeout: 300000 });

test.describe('Scan & Add Items', () => {
  test('entry point, camera refused, manual entry, known barcode and a repeated scan', async ({ page }) => {
    await login(page, A);
    await page.goto('/items');
    await expect(page.getByRole('link', { name: /Scan & Add Items/ }).or(page.getByRole('button', { name: /Scan & Add Items/ })).first()).toBeVisible({
      timeout: 60000,
    });

    await openScanAdd(page);
    // No camera permission is granted to this browser.
    await page.getByRole('button', { name: 'Scan barcode' }).click();
    await expect(page.getByRole('button', { name: 'Close scanner' })).toBeVisible({ timeout: 30000 });
    // Headless Chromium has no camera and grants no permission; the scanner reports why it cannot scan.
    const cameraMessage = page.getByText(/permission denied|blocked|not supported|No camera|requires HTTPS/i).first();
    await expect(cameraMessage).toBeVisible({ timeout: 30000 });
    test.info().annotations.push({ type: 'camera message', description: (await cameraMessage.textContent())?.trim() ?? '' });
    await page.getByRole('button', { name: 'Close scanner' }).click();

    // Manual entry of a barcode the shop already has.
    await typeBarcode(page, KNOWN);
    await expect(page.getByText('Already in your shop')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(KNOWN_NAME).first()).toBeVisible();
    await page.getByRole('button', { name: 'Skip, scan next' }).click();

    // Scanning it again keeps one row for it.
    await typeBarcode(page, KNOWN);
    await expect(page.getByText('Already in your shop')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Skip, scan next' }).click();
    await expect(page.locator('li', { hasText: KNOWN_NAME }).filter({ hasText: 'Already in shop' })).toHaveCount(1);
  });

  test('unknown barcode created by hand with opening stock', async ({ page }) => {
    await login(page, A);
    await openScanAdd(page);
    await typeBarcode(page, UNKNOWN);
    await typeDetailsInstead(page);
    await field(page, 'Product name *').fill(`Manual item ${TAG}`);
    await field(page, 'Purchase price (₹)').fill('12');
    await field(page, 'Selling price (₹)').fill('15');
    await field(page, 'Stock you have now').fill('7');
    await page.getByLabel('Prices include GST').check();
    await page.getByRole('button', { name: 'Save and scan next' }).click();
    await expect(page.locator('li', { hasText: `Manual item ${TAG}` }).filter({ hasText: 'Added · 7' })).toBeVisible({ timeout: 30000 });
  });

  test('product database suggestion is shown for confirmation before saving', async ({ page }) => {
    await login(page, A);
    await openScanAdd(page);
    await typeBarcode(page, HARPIC);
    await expect(page.getByText(/Found .* in a product database/)).toBeVisible({ timeout: 60000 });
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByText(/Filled from a product database/)).toBeVisible();
    await expect(page.getByRole('link', { name: /Data: ProductGuru/ })).toBeVisible();
    await expect(field(page, 'Product name *')).toHaveValue(/harpic/i);
    await expect(field(page, 'Size on pack')).toHaveValue('500 ml');
    // Nothing is saved until the shopkeeper confirms.
    await field(page, 'Product name *').fill(`Harpic 500 ml ${TAG}`);
    await field(page, 'Purchase price (₹)').fill('80');
    await field(page, 'Stock you have now').fill('3');
    await page.getByRole('button', { name: 'Save and scan next' }).click();
    await expect(page.locator('li', { hasText: `Harpic 500 ml ${TAG}` }).filter({ hasText: 'Added · 3' })).toBeVisible({ timeout: 30000 });
  });

  test('a save whose reply is lost is retried from the review without a second item', async ({ page }) => {
    await login(page, A);
    await openScanAdd(page);
    await typeBarcode(page, RETRY);
    await typeDetailsInstead(page);
    await field(page, 'Product name *').fill(`Retry item ${TAG}`);
    await field(page, 'Purchase price (₹)').fill('9');
    await field(page, 'Stock you have now').fill('5');

    // The request reaches the server and is saved, but the browser never gets the answer.
    let dropped = 0;
    await page.route('**/api/items', async (route) => {
      if (route.request().method() !== 'POST' || dropped > 0) return route.continue();
      dropped++;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await page.getByRole('button', { name: 'Save and scan next' }).click();
    await expect(page.getByText(/not saved/i).first()).toBeVisible({ timeout: 30000 });
    await page.unroute('**/api/items');
    expect(dropped).toBe(1);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('li', { hasText: `Retry item ${TAG}` }).filter({ hasText: 'Not saved' })).toBeVisible();

    await page.getByRole('button', { name: 'Review and finish' }).click();
    await page.getByRole('button', { name: /^Not saved \(/ }).click();
    const replay = page.waitForResponse((r) => r.url().endsWith('/api/items') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Try again' }).click();
    const res = await replay;
    // 200 with idempotent: the server returned the item the first request had already created.
    expect(res.status()).toBe(200);
    expect((await res.json()).idempotent).toBe(true);
    await page.getByRole('button', { name: 'Back to scanning' }).click();
    await expect(page.locator('li', { hasText: `Retry item ${TAG}` }).filter({ hasText: 'Added · 5' })).toBeVisible();
  });

  test('review lists what is missing, and Fix edits the item', async ({ page }) => {
    await login(page, A);
    await openScanAdd(page);
    // Each test has its own browser storage, so this one adds the product it reviews.
    await page.getByRole('button', { name: 'Product has no barcode' }).click();
    // A real front photo through the file picker. No Gemini key here, so the text is not read,
    // but the photo still has to come back as the item picture.
    await expect(page.getByText('Photo of the name')).toBeVisible({ timeout: 30000 });
    const sharp = (await import('sharp')).default;
    const photo = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: { r: 230, g: 120, b: 20 } } })
      .jpeg()
      .toBuffer();
    await page.locator('input[type="file"]').setInputFiles({ name: 'front.jpg', mimeType: 'image/jpeg', buffer: photo });
    await expect(page.getByAltText('Item picture')).toHaveCount(0);
    await typeDetailsInstead(page);
    await expect(page.getByAltText('Item picture')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Item picture from the front photo')).toBeVisible();
    await field(page, 'Product name *').fill(`Review item ${TAG}`);
    await field(page, 'Selling price (₹)').fill('15');
    await field(page, 'Purchase price (₹)').fill('10');
    await field(page, 'Stock you have now').fill('2');
    await page.getByRole('button', { name: 'Save and scan next' }).click();
    await expect(page.locator('li', { hasText: `Review item ${TAG}` }).filter({ hasText: 'Added · 2' })).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Review and finish' }).click();
    await expect(page.getByText('Session review')).toBeVisible();
    const row = page.locator('li', { hasText: `Review item ${TAG}` });
    await expect(row.getByText('No HSN')).toBeVisible({ timeout: 30000 });
    await expect(row.getByText('No MRP')).toBeVisible();

    await row.getByRole('button', { name: 'Fix' }).click();
    await page.waitForURL(/\/items\/new\?edit=/, { timeout: 60000 });
    const mrp = page.locator('input[name="mrp"]');
    await expect(mrp).toBeVisible({ timeout: 60000 });
    await mrp.fill('20');
    const saved = page.waitForResponse((r) => /\/api\/items\/[0-9a-f-]+/.test(r.url()) && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Update item' }).click();
    expect((await saved).status()).toBe(200);

    await openScanAdd(page);
    await page.getByRole('button', { name: 'Review and finish' }).click();
    const after = page.locator('li', { hasText: `Review item ${TAG}` });
    await expect(after.getByText('No HSN')).toBeVisible({ timeout: 30000 });
    await expect(after.getByText('No MRP')).toHaveCount(0);
  });

  test('an unfinished product survives closing the page; it can be continued or discarded', async ({ page }) => {
    await login(page, A);
    await openScanAdd(page);
    await typeBarcode(page, DRAFT);
    await typeDetailsInstead(page);
    await field(page, 'Product name *').fill(`Draft item ${TAG}`);
    await field(page, 'Stock you have now').fill('4');
    // Let the draft write happen, then "close" the page.
    await page.waitForTimeout(500);
    await page.goto('/items');
    await openScanAdd(page);
    await expect(page.getByText('Unfinished product on this device')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(new RegExp(`Draft item ${TAG}.*Barcode ${DRAFT}.*Stock 4`))).toBeVisible();

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(field(page, 'Product name *')).toHaveValue(`Draft item ${TAG}`);
    await expect(field(page, 'Stock you have now')).toHaveValue('4');

    await page.reload();
    await expect(page.getByText('Unfinished product on this device')).toBeVisible({ timeout: 60000 });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByText('Unfinished product on this device')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Scan & Add Items' })).toBeVisible({ timeout: 60000 });
    await expect(page.getByText('Unfinished product on this device')).toHaveCount(0);
  });

  test("another business on the same browser sees none of A's draft or barcodes", async ({ page }) => {
    // A leaves an unfinished product behind.
    await login(page, A);
    await openScanAdd(page);
    await typeBarcode(page, DRAFT);
    await typeDetailsInstead(page);
    await field(page, 'Product name *').fill(`A only ${TAG}`);
    await page.waitForTimeout(500);
    await logout(page);

    await login(page, B);
    await openScanAdd(page);
    await expect(page.getByText('Unfinished product on this device')).toHaveCount(0);
    await expect(page.getByText(`A only ${TAG}`)).toHaveCount(0);
    await expect(page.getByText(`Manual item ${TAG}`)).toHaveCount(0);
    // A's barcode is not "already in the shop" for B.
    await typeBarcode(page, KNOWN);
    await expect(page.getByRole('button', { name: 'Type details instead' })).toBeVisible({ timeout: 60000 });
    await expect(page.getByText('Already in your shop')).toHaveCount(0);
    await logout(page);

    await login(page, A);
    await openScanAdd(page);
    await expect(page.getByText('Unfinished product on this device')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(new RegExp(`A only ${TAG}`))).toBeVisible();
  });
});
