/**
 * One-off signed-in GST acceptance walk. Deleted after the report.
 * Does not print passwords. Restores businesses.gstin in finally.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getMigrationDbConfig } = require('./db-config');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const remote = !BASE.includes('localhost');
const PHONE = '7777777777';
const PASSWORD = process.env.E2E_TEST_PASSWORD;
const stamp = Date.now().toString().slice(-8);
const draftBill = `GSTACC-D-${stamp}`;
const finalBill = `GSTACC-F-${stamp}`;
const expenseDesc = `GST acceptance expense ${stamp}`;
const outPath = path.join(process.env.TEMP || '.', `gst-ui-acceptance-${stamp}.json`);

function gstinCheckDigit(body14) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let factor = 2;
  let sum = 0;
  for (let i = body14.length - 1; i >= 0; i--) {
    const code = chars.indexOf(body14[i]);
    let digit = factor * code;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / 36) + (digit % 36);
    sum += digit;
  }
  return chars[(36 - (sum % 36)) % 36];
}

function fakeGstin(stateCode) {
  const state = String(stateCode || '27').padStart(2, '0').slice(0, 2);
  const body = `${state}AAAAA0000A1Z`;
  return body + gstinCheckDigit(body);
}

async function main() {
  if (!PASSWORD) throw new Error('E2E_TEST_PASSWORD is missing');
  const { Pool } = require('pg');
  const pool = new Pool(getMigrationDbConfig());
  const evidence = { started: new Date().toISOString(), steps: [], failures: [] };
  const log = (name, data) => {
    evidence.steps.push({ name, data });
    console.log('STEP', name, JSON.stringify(data));
  };

  const biz = await pool.query(
    `SELECT b.id, b.state_code, b.gstin
       FROM businesses b
       JOIN users u ON u.business_id = b.id
      WHERE u.phone = $1
      LIMIT 1`,
    [PHONE]
  );
  if (!biz.rows[0]) throw new Error('e2e business not found');
  const businessId = biz.rows[0].id;
  const originalGstin = biz.rows[0].gstin;
  const validGstin = fakeGstin(biz.rows[0].state_code);
  log('business', {
    state_code: biz.rows[0].state_code,
    gstin_was_empty: !originalGstin,
    valid_gstin_checksum_ok: gstinCheckDigit(validGstin.slice(0, 14)) === validGstin[14],
  });

  const schema = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'gst_period_status','gst_rcm_rules','gst_return_acknowledgements',
          'purchase_duplicate_overrides','reconciliation_decision_history'
        )
      ORDER BY table_name`
  );
  const rcmCols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'gst_rcm_rules' ORDER BY ordinal_position`
  );
  const rcmCount = await pool.query(`SELECT COUNT(*)::int AS n FROM gst_rcm_rules`);
  const fks = await pool.query(
    `SELECT c.conrelid::regclass::text AS table_name, c.conname,
            pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.conrelid::regclass::text IN (
          'purchase_duplicate_overrides','gst_return_acknowledgements'
        )`
  );
  const migrations = await pool.query(
    `SELECT version FROM schema_migrations WHERE version IN ('396','397') ORDER BY version`
  ).catch(async () => {
    const alt = await pool.query(
      `SELECT filename FROM migrations WHERE filename LIKE '%396%' OR filename LIKE '%397%' ORDER BY filename`
    ).catch(() => ({ rows: [] }));
    return alt;
  });
  log('schema', {
    tables: schema.rows.map((r) => r.table_name),
    rcm_columns: rcmCols.rows,
    rcm_count: rcmCount.rows[0].n,
    foreign_keys: fks.rows,
    migrations: migrations.rows,
  });

  async function snapshot(label, purchaseId, expenseId) {
    const purchase = purchaseId
      ? await pool.query(
          `SELECT id, status, bill_number, notes, grand_total, deleted_at IS NOT NULL AS deleted
             FROM purchases WHERE id = $1`,
          [purchaseId]
        )
      : { rows: [] };
    const items = purchaseId
      ? await pool.query(
          `SELECT item_name, quantity, unit_price FROM purchase_items WHERE purchase_id = $1`,
          [purchaseId]
        )
      : { rows: [] };
    const ledger = purchaseId
      ? await pool.query(
          `SELECT voucher_type, COUNT(*)::int AS lines,
                  COUNT(*) FILTER (WHERE is_reversal IS TRUE)::int AS reversal_lines
             FROM ledger_entry_lines
            WHERE business_id = $1 AND voucher_id = $2
            GROUP BY voucher_type`,
          [businessId, purchaseId]
        ).catch(async () => {
          return pool.query(
            `SELECT voucher_type, COUNT(*)::int AS lines
               FROM ledger_entry_lines
              WHERE business_id = $1 AND voucher_id = $2
              GROUP BY voucher_type`,
            [businessId, purchaseId]
          );
        })
      : { rows: [] };
    const stock = purchaseId
      ? await pool.query(
          `SELECT type, COUNT(*)::int AS n
             FROM stock_movements
            WHERE business_id = $1 AND reference_type = 'purchase' AND reference_id = $2
            GROUP BY type`,
          [businessId, purchaseId]
        ).catch(() => ({ rows: [], error: 'stock_movements query failed' }))
      : { rows: [] };
    const periods = await pool.query(
      `SELECT kind, period_key, state FROM gst_period_status
        WHERE business_id = $1
        ORDER BY changed_at DESC NULLS LAST
        LIMIT 8`,
      [businessId]
    );
    const expense = expenseId
      ? await pool.query(
          `SELECT id, description, amount, is_reverse_charge, deleted_at IS NOT NULL AS deleted
             FROM expenses WHERE id = $1`,
          [expenseId]
        )
      : { rows: [] };
    log(label, {
      purchase: purchase.rows,
      items: items.rows,
      ledger: ledger.rows,
      stock: stock.rows || stock,
      periods: periods.rows,
      expense: expense.rows,
    });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);
  const failed = [];
  page.on('response', (res) => {
    const url = res.url();
    if (res.status() >= 400 && url.includes('/api/')) {
      failed.push({ status: res.status(), url: url.replace(BASE, '') });
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') evidence.failures.push({ console: msg.text().slice(0, 300) });
  });
  page.on('dialog', async (dialog) => {
    evidence.steps.push({ name: 'dialog', data: { type: dialog.type(), message: dialog.message() } });
    console.log('DIALOG', dialog.message().slice(0, 240));
    await dialog.accept();
  });

  let draftId = null;
  let finalId = null;
  let expenseId = null;
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    let loggedIn = false;
    for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
      if (attempt > 1) {
        await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      }
      try {
        await page.waitForFunction(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Continue') || (b.textContent || '').includes('Login'));
          return btn && Object.keys(btn).some((k) => k.startsWith('__react'));
        }, null, { timeout: 60000 });
      } catch {
        log('login_hydrate', { attempt, note: 'button had no React key' });
      }
      if (await page.getByPlaceholder('Enter your phone number').isVisible().catch(() => false)) {
        await page.getByPlaceholder('Enter your phone number').fill(PHONE);
        await page.getByRole('button', { name: 'Continue' }).click();
      }
      const passwordBox = page.getByPlaceholder('Enter your password');
      try {
        await passwordBox.waitFor({ timeout: 15000 });
      } catch {
        log('login_stuck', { attempt, text: (await page.locator('main').innerText()).slice(0, 300) });
        continue;
      }
      await passwordBox.fill(PASSWORD);
      const loginResponse = page.waitForResponse(
        (res) => res.url().includes('/api/auth/login'),
        { timeout: 45000 }
      );
      await page.getByRole('button', { name: 'Login' }).click();
      const loginRes = await loginResponse.catch(() => null);
      const status = loginRes ? loginRes.status() : 0;
      if (status >= 400) {
        const body = await loginRes.json().catch(() => null);
        log('login_retry', { attempt, status, error: body?.error || null });
        await page.waitForTimeout(2000);
        continue;
      }
      try {
        await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: status === 200 ? 60000 : 20000 });
        loggedIn = true;
      } catch {
        if (!page.url().includes('/login')) loggedIn = true;
        else {
          log('login_retry', {
            attempt,
            status,
            still: page.url(),
            text: (await page.locator('main').innerText().catch(() => '')).slice(0, 240),
          });
        }
      }
    }
    if (!loggedIn) throw new Error('login did not leave /login');
    log('login', { url: page.url() });

    const suppliersReady = page.waitForResponse(
      (res) => res.url().includes('/api/suppliers?') && res.request().method() === 'GET',
      { timeout: 30000 }
    ).catch(() => null);
    await page.goto(`${BASE}/purchases/new`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    try {
      await page.getByPlaceholder('Search supplier...').waitFor({ timeout: 90000 });
    } catch (err) {
      log('purchase_form_missing', { text: (await page.locator('body').innerText()).slice(0, 800) });
      throw err;
    }
    const rcmOnPurchase = await page.locator('text=RCM coverage: incomplete').count();
    log('purchase_rcm_warning', { visible: rcmOnPurchase > 0 });
    await page.getByPlaceholder('Search supplier...').click();
    await page.getByPlaceholder('Search supplier...').fill('a');
    const suppliersRes = await suppliersReady;
    if (suppliersRes) {
      const suppliersBody = await suppliersRes.json().catch(() => null);
      log('suppliers', { status: suppliersRes.status(), code: suppliersBody?.code || null, count: suppliersBody?.suppliers?.length ?? null });
    }
    const supplierRow = page.locator('.supplier-dropdown-container .cursor-pointer').first();
    await supplierRow.waitFor({ timeout: 15000 });
    const supplierName = await supplierRow.locator('.font-medium').innerText();
    await supplierRow.click();
    await page.getByPlaceholder('Invoice number').fill(draftBill);
    await page.getByRole('button', { name: 'Add Goods' }).click();
    await page.getByPlaceholder('Search Item').fill(`GST accept item ${stamp}`);
    const rate = page.locator('table input[type="number"]').nth(1);
    await rate.fill('100');
    const createWait = page.waitForResponse(
      (res) => res.url().includes('/api/purchases') && res.request().method() === 'POST',
      { timeout: 60000 }
    );
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    const created = await createWait;
    const createdBody = await created.json().catch(() => null);
    draftId = createdBody?.purchase?.id || null;
    log('purchase_create', {
      status: created.status(),
      id: draftId,
      bill: createdBody?.purchase?.bill_number || null,
      item_error: createdBody?.code || createdBody?.error || null,
      supplier: supplierName,
    });
    await snapshot('after_draft_create', draftId, null);

    if (draftId) {
      await page.goto(`${BASE}/purchases`, { waitUntil: 'domcontentloaded' });
      await page.getByPlaceholder(/Bill number|Search purchases/).first().fill(draftBill);
      await page.waitForTimeout(800);
      await page.getByTitle('Edit Purchase').first().click();
      await page.getByPlaceholder('Invoice number').waitFor({ timeout: 30000 });
      await page.waitForFunction(
        (bill) => {
          const el = document.querySelector('input[placeholder="Invoice number"]');
          return el && el.value === bill;
        },
        draftBill,
        { timeout: 20000 }
      );
      const notes = page.locator('textarea').last();
      await notes.fill(`Edited draft ${stamp}`);
      const editWait = page.waitForResponse(
        (res) => res.url().includes('/api/purchases') && res.request().method() === 'POST',
        { timeout: 60000 }
      );
      await page.getByRole('button', { name: 'Save as Draft' }).click();
      const edited = await editWait;
      const editedBody = await edited.json().catch(() => null);
      log('purchase_edit', {
        status: edited.status(),
        id: editedBody?.purchase?.id || null,
        notes: editedBody?.purchase?.notes || null,
        same_id: editedBody?.purchase?.id === draftId,
      });
      await snapshot('after_draft_edit', draftId, null);

      await page.goto(`${BASE}/purchases`, { waitUntil: 'domcontentloaded' });
      await page.getByPlaceholder(/Bill number|Search purchases/).first().fill(draftBill);
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: 'Delete draft' }).first().click();
      const delWait = page.waitForResponse(
        (res) => res.url().includes(`/api/purchases/${draftId}`) && res.request().method() === 'DELETE',
        { timeout: 30000 }
      );
      await page.getByRole('button', { name: 'Delete draft' }).last().click();
      const deleted = await delWait;
      log('purchase_delete', { status: deleted.status(), body: await deleted.json().catch(() => null) });
      await snapshot('after_draft_delete', draftId, null);
    }

    await page.goto(`${BASE}/purchases/new`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.getByPlaceholder('Search supplier...').waitFor({ timeout: 90000 });
    await page.getByPlaceholder('Search supplier...').click();
    await page.getByPlaceholder('Search supplier...').fill('a');
    await page.locator('.supplier-dropdown-container .cursor-pointer').first().click();
    await page.getByPlaceholder('Invoice number').fill(finalBill);
    await page.getByRole('button', { name: 'Add Service' }).click();
    await page.getByPlaceholder('Search Item').fill(`GST accept service ${stamp}`);
    await page.locator('table input[type="number"]').nth(1).fill('50');
    const finalWait = page.waitForResponse(
      (res) => res.url().includes('/api/purchases') && res.request().method() === 'POST',
      { timeout: 60000 }
    );
    await page.getByRole('button', { name: 'Save & Finalize' }).click();
    const finalized = await finalWait;
    const finalBody = await finalized.json().catch(() => null);
    finalId = finalBody?.purchase?.id || null;
    log('purchase_finalize', {
      status: finalized.status(),
      id: finalId,
      purchase_status: finalBody?.purchase?.status || null,
      error: finalBody?.error || finalBody?.code || null,
    });
    await snapshot('after_finalize', finalId, null);
    if (finalId && finalBody?.purchase?.status === 'final') {
      await page.goto(`${BASE}/purchases`, { waitUntil: 'domcontentloaded' });
      await page.getByPlaceholder(/Bill number|Search purchases/).first().fill(finalBill);
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: 'Cancel bill' }).first().click();
      await page.getByRole('textbox').last().fill('GST acceptance cancel');
      const cancelWait = page.waitForResponse(
        (res) => res.request().method() === 'DELETE' || res.url().includes('/cancel'),
        { timeout: 60000 }
      );
      await page.getByRole('button', { name: 'Cancel bill' }).last().click();
      const cancelled = await cancelWait;
      log('purchase_cancel', { status: cancelled.status(), url: cancelled.url().replace(BASE, '') });
      await snapshot('after_cancel', finalId, null);
    }

    await page.goto(`${BASE}/expenses`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Add Expense' }).click();
    await page.getByRole('heading', { name: 'Add Expense' }).waitFor({ timeout: 10000 });
    const banner = await page.locator('text=RCM coverage is incomplete until notified-supply rules are loaded').count();
    const rcmChecked = await page.getByRole('checkbox', { name: /Reverse charge/ }).isChecked();
    log('expense_rcm_warning', { banner, rcm_checked: rcmChecked });
    const category = page.locator('select').first();
    const optionValue = await category.locator('option').nth(1).getAttribute('value');
    if (optionValue) await category.selectOption(optionValue);
    await page.getByPlaceholder('0.00').fill('125');
    await page.locator('textarea').last().fill(expenseDesc);
    const expWait = page.waitForResponse(
      (res) => res.url().includes('/api/expenses') && res.request().method() === 'POST',
      { timeout: 30000 }
    );
    await page.getByRole('button', { name: 'Add Expense' }).last().click();
    const expRes = await expWait;
    const expBody = await expRes.json().catch(() => null);
    expenseId = expBody?.expense?.id || expBody?.id || null;
    log('expense_create', {
      status: expRes.status(),
      id: expenseId,
      rcm: expBody?.expense?.is_reverse_charge ?? expBody?.is_reverse_charge ?? null,
      error: expBody?.error || null,
    });
    await snapshot('after_expense_create', null, expenseId);

    if (expenseId) {
      await page.getByRole('button', { name: 'Edit' }).first().click();
      await page.getByRole('heading', { name: 'Edit Expense' }).waitFor({ timeout: 10000 });
      await page.getByPlaceholder('0.00').fill('126');
      const putWait = page.waitForResponse(
        (res) => res.url().includes(`/api/expenses/${expenseId}`) && res.request().method() === 'PUT',
        { timeout: 30000 }
      );
      await page.getByRole('button', { name: /Update|Save/ }).last().click();
      const putRes = await putWait;
      log('expense_edit', { status: putRes.status() });
      await snapshot('after_expense_edit', null, expenseId);
      const row = page.locator('tr', { hasText: expenseDesc });
      await row.getByRole('button', { name: 'Reverse' }).click();
      await page.getByRole('textbox').last().fill('GST acceptance reversal');
      const revWait = page.waitForResponse(
        (res) => res.url().includes(`/api/expenses/${expenseId}`) && res.request().method() === 'DELETE',
        { timeout: 30000 }
      );
      await page.getByRole('button', { name: 'Reverse entry' }).click();
      const rev = await revWait;
      log('expense_reverse', { status: rev.status() });
      await snapshot('after_expense_reverse', null, expenseId);
    }

    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    const pendingApi = await page.waitForResponse(
      (res) => res.url().includes('/api/gst/itc-decisions/pending'),
      { timeout: 20000 }
    );
    const pendingBody = await pendingApi.json().catch(() => null);
    await page.getByLabel(/Pending Actions/).click();
    await page.getByRole('heading', { name: 'Pending Actions' }).waitFor({ timeout: 5000 });
    const menuText = await page.locator('text=GSTR-2B not imported').count();
    const zeroBadge = await page.locator('text=/^0$/').count();
    log('pending_itc_menu', {
      api_status: pendingApi.status(),
      api: pendingBody,
      menu_has_not_imported: menuText > 0,
      menu_text_sample: (await page.locator('.space-y-2').innerText().catch(() => '')).slice(0, 400),
      numeric_zero_nodes: zeroBadge,
    });

    await page.goto(`${BASE}/reports/gst/gstr1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    log('gstr1_before_gstin', {
      profile_panel: await page.locator('text=Complete your business profile').count(),
      export_json: await page.getByRole('button', { name: 'Export JSON' }).count(),
    });

    if (!remote) await pool.query(`UPDATE businesses SET gstin = $1 WHERE id = $2`, [validGstin, businessId]);
    for (const route of ['gstr1', 'gstr3b', 'gstr9']) {
      await page.goto(`${BASE}/reports/gst/${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      const exportCount = await page.getByRole('button', { name: 'Export JSON' }).count();
      const profile = await page.locator('text=Complete your business profile').count();
      log(`${route}_controls`, { export_json: exportCount, profile_panel: profile, url: page.url() });
      if (!exportCount) continue;
      const readyWait = page.waitForResponse(
        (res) => res.url().includes('/api/gst/return-readiness') && res.request().method() === 'GET',
        { timeout: 180000 }
      );
      await page.getByRole('button', { name: 'Export JSON' }).click();
      const ready = await readyWait;
      const readyBody = await ready.json().catch(() => null);
      log(`${route}_readiness`, {
        status: ready.status(),
        blocked: readyBody?.blocked ?? null,
        blockKeys: readyBody?.blockKeys || null,
        needs: (readyBody?.needsAcknowledgement || []).map((i) => i.key).slice(0, 8),
        filingNote: readyBody?.filingNote || null,
        freshness: readyBody?.freshness || null,
      });
      await page.waitForTimeout(1500);
      const filed = await page.locator('text=✓ Filed').count();
      const draftBadge = await page.locator('text=Draft').count();
      log(`${route}_after_export_click`, { filed_badge: filed, draft_badge: draftBadge });
    }
  } catch (error) {
    evidence.failures.push({ message: error.message, url: page.url() });
    console.log('FAIL', error.message, page.url());
    await page.screenshot({ path: path.join(process.env.TEMP || '.', `gst-ui-fail-${stamp}.png`), fullPage: true }).catch(() => {});
  } finally {
    if (!remote) await pool.query(`UPDATE businesses SET gstin = $1 WHERE id = $2`, [originalGstin, businessId]);
    const restored = await pool.query(`SELECT gstin IS NULL AS empty FROM businesses WHERE id = $1`, [businessId]);
    log('gstin_restored', { empty: restored.rows[0]?.empty });
    evidence.failed_requests = failed.slice(0, 40);
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
    console.log('WROTE', outPath);
    await browser.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('FATAL', err.message);
  process.exit(1);
});
