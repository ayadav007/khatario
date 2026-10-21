/**
 * Staging browser workflows. One login, then the same page for every step.
 *
 * Does not change playwright.config.ts. Run only when login is allowed:
 *   STAGING_TEST_BUSINESS="<designated test business>" \
 *   npx playwright test --config=playwright.staging.config.ts
 *
 * Missing account, the wrong host, or "Too many login attempts. Please try again later."
 * skips the mutating steps. Playwright reports that skip. The QA status is BLOCKED.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import {
  createdRecords,
  rememberRecord,
  signInOnce,
  stagingConfigBlock,
  writeRecordLedger,
} from './helpers/staging-session';

test.describe.configure({ mode: 'serial', retries: 0 });

let gate: string | null = null;
let context: BrowserContext | null = null;
let page: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  gate = stagingConfigBlock(testInfo);
  if (gate) return;
  context = await browser.newContext({
    baseURL: 'https://staging.khatario.com',
    viewport: { width: 1440, height: 900 },
  });
  page = await context.newPage();
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'prompt') await dialog.accept('P3QB cancel reason');
    else await dialog.dismiss();
  });
  gate = await signInOnce(page);
});

test.afterAll(async () => {
  writeRecordLedger();
  await context?.close();
});

test.beforeEach(() => {
  test.skip(Boolean(gate), gate || undefined);
});

test('sales invoice validation, create, list, and reopen', async () => {
  test.setTimeout(180000);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const mark = `P3QB${stamp}`;
  const customerName = `${mark} Customer`;
  const serviceName = `${mark} Service`;

  await page.goto('/invoices/new');
  await expect(page.getByRole('button', { name: /generate invoice/i })).toBeVisible();
  await page.getByRole('button', { name: /generate invoice/i }).click();
  await expect(page.locator('.bg-red-50').filter({ hasText: 'Add items' })).toBeVisible();
  await expect(page).toHaveURL(/\/invoices\/new$/);

  await page.goto('/customers/new');
  await page.locator('input[name="name"]').fill(customerName);
  await page.locator('select[name="state"]').selectOption('Karnataka');
  await page.getByRole('button', { name: /save customer/i }).click();
  await expect(page.getByText(customerName).first()).toBeVisible();
  rememberRecord({ kind: 'customer', name: customerName });

  await page.goto('/items/new');
  await page.getByRole('button', { name: /no stock/i }).click();
  await page.locator('input[name="name"]').fill(serviceName);
  await page.locator('input[name="selling_price"]').fill('100');
  await page.locator('select[name="tax_rate"]').selectOption('18');
  await page.getByRole('button', { name: /save item/i }).click();
  await expect(page.getByText(serviceName).first()).toBeVisible();
  rememberRecord({ kind: 'item', name: serviceName });

  await page.goto('/invoices/new');
  await page.evaluate((key) => localStorage.removeItem(key), 'invoiceClassicDesktop');
  await page.reload();
  await expect(page.getByRole('button', { name: /classic form/i })).toBeVisible();
  await page.getByPlaceholder(/search customer by name or phone/i).fill(customerName);
  await page.getByRole('button', { name: new RegExp(customerName, 'i') }).first().click();
  await page.getByRole('button', { name: /add items/i }).first().click();
  const dialog = page.getByRole('dialog', { name: /add items/i });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder(/search by item name/i).fill(serviceName);
  await expect(dialog.getByText(serviceName).first()).toBeVisible();
  await dialog.getByRole('button', { name: /^add$/i }).first().click();
  const addToBill = dialog.getByRole('button', { name: /add \d+ to bill/i });
  await expect(addToBill).toBeEnabled();
  await addToBill.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/CGST \+ SGST/i).first()).toBeVisible();
  await expect(page.getByText(/₹?\s*118(\.00)?/).first()).toBeVisible();

  await page.getByRole('button', { name: /generate invoice/i }).click();
  const shareHeading = page.getByRole('heading', { name: 'Share Invoice' });
  await expect(shareHeading).toBeVisible();
  await expect(page.getByRole('button', { name: /send via email/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /send via whatsapp/i })).toBeDisabled();
  const numberLine = page.getByText(/INV-\d+ · Final/);
  await expect(numberLine).toBeVisible();
  const invoiceNo = ((await numberLine.textContent()) || '').match(/INV-\d+/)?.[0] || '';
  expect(invoiceNo).toMatch(/^INV-\d+$/);
  await expect(page).toHaveURL(/\/invoices\/new$/);
  await shareHeading.locator('xpath=following-sibling::button').click();
  await expect(shareHeading).toBeHidden();
  await expect(page.getByText(`${invoiceNo} · Final`)).toBeVisible();
  await expect(page.getByText(customerName).first()).toBeVisible();
  rememberRecord({ kind: 'invoice', name: customerName, invoiceNumber: invoiceNo });

  const allInvoices = page.getByRole('link', { name: 'All Invoices' });
  if (!(await allInvoices.isVisible())) {
    await page.getByRole('link', { name: 'Sales', exact: true }).click();
  }
  await allInvoices.click();
  await expect(page).toHaveURL(/\/invoices\/?(\?.*)?$/);
  await page.getByPlaceholder('Search invoice number or customer').fill(invoiceNo);
  await page.getByRole('button', { name: new RegExp(invoiceNo) }).first().click();
  await expect(page.getByRole('heading', { name: invoiceNo, level: 2 })).toBeVisible();
  await expect(page.getByText(customerName).first()).toBeVisible();
  await expect(page.getByText('Final', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Grand Total')).toBeVisible();
  await expect(page.getByText(/₹\s*118(\.00)?/).first()).toBeVisible();
  expect(createdRecords().some((row) => row.invoiceNumber === invoiceNo)).toBeTruthy();
});

test('purchase, stock, and purchase return', async () => {
  test.setTimeout(180000);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const mark = `P3QB${stamp}`;
  const supplierName = `${mark} Supplier`;
  const goodsName = `${mark} Goods`;

  await page.goto('/items/new');
  await page.getByRole('button', { name: /stock is tracked/i }).click();
  await page.locator('input[name="name"]').fill(goodsName);
  await page.locator('input[name="selling_price"]').fill('100');
  const purchasePrice = page.locator('input[name="purchase_price"]');
  if (await purchasePrice.isVisible()) await purchasePrice.fill('100');
  await page.locator('select[name="tax_rate"]').selectOption('18');
  await page.getByRole('button', { name: /save item/i }).click();
  await expect(page.getByText(goodsName).first()).toBeVisible();
  rememberRecord({ kind: 'item', name: goodsName });

  await page.goto('/suppliers/new');
  await page.getByPlaceholder('Enter supplier name').fill(supplierName);
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Select State' }) }).selectOption('Karnataka');
  await page.getByRole('button', { name: /create supplier/i }).click();
  await expect(page.getByText(supplierName).first()).toBeVisible();
  rememberRecord({ kind: 'supplier', name: supplierName });

  await page.goto('/purchases/new');
  await expect(page.getByRole('button', { name: /save & finalize/i })).toBeVisible();
  await page.getByPlaceholder(/search your suppliers/i).fill(supplierName);
  await page.getByRole('button', { name: new RegExp(supplierName, 'i') }).first().click();
  const warehouse = page.locator('label', { hasText: /receiving warehouse/i }).locator('xpath=following::select[1]');
  const receivingWarehouse = (await warehouse.isVisible())
    ? ((await warehouse.locator('option:checked').textContent()) || '').trim()
    : '';
  await page.getByPlaceholder(/add item — search catalogue/i).fill(goodsName);
  await page.getByRole('option', { name: new RegExp(goodsName, 'i') }).first().click();
  await page.locator('[data-field="quantity"]').fill('2');
  const bill = page.getByPlaceholder(/bill number/i);
  if (await bill.isVisible()) await bill.fill(`${mark}-BILL`);
  await expect(page.getByText(/CGST \+ SGST|Intra-state/i).first()).toBeVisible();
  await page.getByRole('button', { name: /save & finalize/i }).click();
  await expect(page.getByText(supplierName).first()).toBeVisible();
  rememberRecord({ kind: 'purchase', name: `${mark}-BILL` });

  await page.goto('/reports/stock/valuation');
  await page.getByRole('button', { name: /generate report/i }).click();
  const stockRow = page.getByRole('row', { name: new RegExp(goodsName, 'i') });
  await expect(stockRow).toBeVisible();
  await expect(stockRow).toContainText(/2(\.000)?/);
  console.log(`purchase warehouse shown on the bill: ${receivingWarehouse || 'no receiving warehouse control'}`);

  await page.goto('/purchase-returns/new');
  await expect(page.locator('form').getByText('Receiving warehouse')).toHaveCount(0);
  await page.getByPlaceholder('PR-001').fill(`${mark}-PR`);
  await page.locator('select').first().selectOption({ label: supplierName });
  await page.getByRole('button', { name: /add item/i }).click();
  await page.locator('select').last().selectOption({ label: goodsName });
  await page.locator('input[type="number"]').first().fill('1');
  await page.locator('input[type="number"]').nth(1).fill('100');
  await page.locator('input[type="number"]').nth(2).fill('18');
  await expect(page.getByText(/grand total/i)).toBeVisible();
  await page.getByRole('button', { name: /create purchase return/i }).click();
  await expect(page.getByText(`${mark}-PR`).first()).toBeVisible();
  rememberRecord({ kind: 'purchase_return', name: `${mark}-PR` });
  const cancel = page.getByRole('button', { name: /cancel return/i });
  if (!(await cancel.isVisible())) await page.getByText(`${mark}-PR`).first().click();
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByText(/cancelled/i).first()).toBeVisible();
});
