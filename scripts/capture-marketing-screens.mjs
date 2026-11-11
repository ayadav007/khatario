#!/usr/bin/env node
/**
 * Capture real app screenshots of the seeded demo business for the marketing home page.
 *
 *   node scripts/seed-marketing-demo.mjs        # once
 *   node scripts/capture-marketing-screens.mjs  # writes public/marketing/screens/*.png
 *
 * Env: DEMO_BASE_URL (default http://localhost:3000), DEMO_PHONE, DEMO_PASSWORD,
 *      ONLY=invoice-new,gstr1 to recapture a subset.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = (process.env.DEMO_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PHONE = process.env.DEMO_PHONE || '9000000001';
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@12345';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'marketing', 'screens');
const PAGE_TIMEOUT = 300_000;
const TEMPLATES_OUT = path.join(OUT, '..', 'templates');

/** Must stay in sync with TEMPLATES in components/marketing/landing/LandingTemplateGallery.tsx. */
const TEMPLATE_IDS = [
  'gst_standard',
  'modern',
  'classic',
  'elegant',
  'minimal',
  'business_pro',
  'tally_style',
  'gst_detailed',
  'export_invoice',
  'composition_standard',
  'credit_standard',
  'challan_standard',
  'thermal_80mm',
  'thermal_58mm',
];

/** Preview sample data names a company that may be real; marketing images use fictional brands. */
const BRAND_SWAPS = [
  [/Digitable/g, 'Sharma Traders'],
  [/digitable\.com/gi, 'sharmatraders.in'],
  [/XYZ Enterprises Pvt\. Ltd\./g, 'Green Leaf Foods Pvt. Ltd.'],
  [/XYZ Enterprises/g, 'Green Leaf Foods'],
  [/xyzenterprises\.com/gi, 'greenleaffoods.in'],
];

if (/khatario\.com/i.test(BASE) && !/staging\.khatario\.com/i.test(BASE)) {
  console.error('Refusing to run against production. Use localhost or staging.');
  process.exit(1);
}

const HIDE_CSS = `
  nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }
  *, *::before, *::after { transition: none !important; animation-duration: 0s !important; caret-color: transparent !important; }
`;

async function json(res) {
  const body = await res.json().catch(() => null);
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** Fills the new-invoice composer like a cashier would (customer, then items with quantities in the picker); nothing is saved. */
async function fillNewInvoice(page) {
  await page.getByPlaceholder('Search customer by name or phone').fill('Sharma');
  await page.getByText('Sharma & Sons').first().click({ timeout: 30_000 });
  await page.waitForTimeout(1000);

  const lines = [
    ['Basmati', 'Basmati Rice 5kg', 4],
    ['Toor', 'Toor Dal 1kg', 10],
    ['Sunflower', 'Sunflower Oil 1L', 6],
    ['Detergent', 'Detergent Powder 1kg', 5],
  ];
  await page.getByRole('button', { name: /Add items/ }).first().click();
  const search = page.getByPlaceholder('Search by item name, code or barcode');
  for (const [query, name, qty] of lines) {
    await search.fill(query);
    await page.getByText(name, { exact: true }).last().click({ timeout: 30_000 });
    const qtyInput = page.locator('input[data-qty-input="true"]:visible').first();
    await qtyInput.fill(String(qty));
    await page.waitForTimeout(400);
  }
  await search.press('Control+Enter');
  // Let the "Added 4 products" toast go before the shot.
  await page.getByText(/Added \d+ products/).first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.mouse.move(1439, 899);
}

/** GSTR-1 for last month, which has the demo shop's B2B bills (the current month may have none yet). */
async function pickLastGstMonth(page) {
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const monthName = lastMonth.toLocaleString('en-IN', { month: 'long' });
  const selects = page.locator('select:visible');
  await selects.first().selectOption({ label: monthName });
  await selects.nth(1).selectOption({ label: String(lastMonth.getFullYear()) }).catch(() => {});
  await page.getByRole('button', { name: 'Refresh' }).click().catch(() => {});
  await page.getByText('No B2B invoices found').first().waitFor({ state: 'hidden', timeout: 120_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function pickMonthRange(page) {
  const select = page.locator('select:visible').filter({ has: page.locator('option', { hasText: 'Today' }) }).first();
  // Early in a month "This Month" is only a day or two of sales, so prefer a full past period.
  const label = await select.evaluate((el) => {
    const options = [...el.options].map((o) => o.textContent.trim());
    return (
      options.find((t) => /last month/i.test(t)) ??
      options.find((t) => /last 30|30 days/i.test(t)) ??
      options.find((t) => /this month/i.test(t))
    );
  });
  if (!label) return;
  await select.selectOption({ label });
  // The cards drop their "Today's …" labels once the new range has loaded.
  await page.getByText(/today's sales/i).first().waitFor({ state: 'hidden', timeout: 180_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function firstInvoiceId(request, paymentStatus) {
  const res = await json(await request.get(`${BASE}/api/invoices?status=final&limit=100`));
  const list = res.invoices ?? res.data ?? [];
  const hit = list.find((i) => i.payment_status === paymentStatus && i.customer_id) ?? list[0];
  return hit.id;
}

async function settle(page, readyText) {
  await page.waitForFunction(
    (text) =>
      document.body.innerText.includes(text) ||
      [...document.querySelectorAll('input, textarea')].some((el) => el.value.includes(text)),
    readyText,
    { timeout: PAGE_TIMEOUT, polling: 1000 },
  );
  await page.getByRole('link', { name: 'Dashboard' }).first().waitFor({ timeout: PAGE_TIMEOUT }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: PAGE_TIMEOUT }).catch(() => {});
  await page.getByText('Loading...').first().waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
  await page.addStyleTag({ content: HIDE_CSS });
  await page.mouse.move(1439, 899);
  await page.waitForTimeout(1500);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
  const { request } = context;

  await json(await request.post(`${BASE}/api/auth/login`, { data: { phone: PHONE, password: PASSWORD } }));
  await request.patch(`${BASE}/api/user/product-tour`, { data: { action: 'complete' } });

  const partialId = await firstInvoiceId(request, 'partially_paid');

  const shots = [
    { name: 'dashboard', url: '/dashboard', ready: 'Sales insights', act: pickMonthRange },
    { name: 'invoice-new', url: '/invoices/new', ready: 'Add items', act: fillNewInvoice },
    {
      name: 'invoice-share',
      url: `/invoices/${partialId}/view`,
      ready: 'Download PDF',
      async act(page) {
        await page.getByRole('button', { name: 'Share' }).first().click();
        await page.waitForTimeout(1500);
      },
    },
    { name: 'invoices-list', url: '/invoices', ready: 'Partially' },
    { name: 'gstr1', url: '/reports/gst/gstr1', ready: 'B2B Invoices', act: pickLastGstMonth },
  ];

  const page = await context.newPage();
  for (const shot of shots) {
    if (ONLY && !ONLY.has(shot.name)) continue;
    const started = Date.now();
    await page.goto(`${BASE}${shot.url}`, { timeout: PAGE_TIMEOUT });
    await settle(page, shot.ready);
    if (shot.act) await shot.act(page);
    await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
    console.log(`✓ ${shot.name}.png (${Math.round((Date.now() - started) / 1000)}s)`);
  }

  if (!ONLY || ONLY.has('templates')) await captureTemplates(context);

  await browser.close();
  console.log(`\nSaved to ${path.relative(process.cwd(), OUT)} and ${path.relative(process.cwd(), TEMPLATES_OUT)}`);
}

async function captureTemplates(context) {
  await mkdir(TEMPLATES_OUT, { recursive: true });
  const page = await context.newPage();
  await page.route('**/api/template-preview**', async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    for (const [from, to] of BRAND_SWAPS) html = html.replace(from, to);
    await route.fulfill({ response: res, body: html });
  });

  for (const id of TEMPLATE_IDS) {
    const thermal = id.startsWith('thermal_');
    await page.setViewportSize(thermal ? { width: id === 'thermal_58mm' ? 260 : 340, height: 900 } : { width: 794, height: 1123 });
    await page.goto(`${BASE}/api/template-preview?template_id=${id}`, { timeout: PAGE_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await page.addStyleTag({ content: 'html, body { background: #fff !important; }' });
    await page.waitForTimeout(500);
    let clip;
    if (thermal) {
      const bottom = await page.evaluate(() =>
        Math.max(
          ...[...document.querySelectorAll('body *')]
            .filter((el) => !['fixed', 'sticky'].includes(getComputedStyle(el).position) && el.getBoundingClientRect().height > 0)
            .filter((el) => ![...document.querySelectorAll('*')].some((a) => getComputedStyle(a).position === 'fixed' && a.contains(el)))
            .map((el) => el.getBoundingClientRect().bottom),
        ),
      );
      const { width } = page.viewportSize();
      clip = { x: 0, y: 0, width, height: Math.ceil(bottom) + 16 };
    }
    await page.screenshot({ path: path.join(TEMPLATES_OUT, `${id}.png`), clip, fullPage: thermal });
    console.log(`✓ templates/${id}.png`);
  }
  await page.close();
}

main().catch((e) => {
  console.error('\nCapture failed:', e.message);
  process.exit(1);
});
