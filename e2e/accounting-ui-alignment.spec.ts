import { test, expect, type Page, type Route } from '@playwright/test';
import { discoverBaseUrl } from './helpers/discover-base-url';
import { hasDbConfig } from './helpers/db';
import { provisionRbacBusiness, type RbacPersona } from './helpers/subscription-rbac-personas';

/**
 * Accounting UI alignment: purchase actions follow bill status, cancellation blockers and period
 * locks surface readable messages, and expense / journal deletes are presented as reversals.
 * List and action APIs are intercepted so each backend outcome can be exercised deterministically.
 */

test.describe.configure({ mode: 'serial' });

let baseUrl = '';
let owner: RbacPersona;
let cleanup: (() => Promise<void>) | null = null;

const P = {
  draft: 'e2e-p-draft',
  open: 'e2e-p-open',
  paid: 'e2e-p-paid',
  cancelled: 'e2e-p-cancelled',
};

const purchaseRow = (id: string, over: Record<string, unknown>) => ({
  id,
  supplier_id: 'e2e-supplier',
  supplier_name: 'E2E Supplier',
  bill_date: '2026-09-01',
  status: 'final',
  payment_status: 'unpaid',
  grand_total: 0,
  paid_amount: 0,
  balance_amount: 0,
  itc_eligible: true,
  itc_availed: false,
  created_at: '2026-09-01T00:00:00Z',
  ...over,
});

const PURCHASES = [
  purchaseRow(P.draft, { bill_number: 'BILL-DRAFT', status: 'draft', grand_total: 200 }),
  purchaseRow(P.open, { bill_number: 'BILL-OPEN', grand_total: 1000 }),
  purchaseRow(P.paid, { bill_number: 'BILL-PAID', grand_total: 500, paid_amount: 500, payment_status: 'paid' }),
  purchaseRow(P.cancelled, { bill_number: 'BILL-CANCELLED', status: 'cancelled', grand_total: 9999 }),
];

const DIALOG_TITLE = /^(Cancel bill|Delete draft bill|Reverse expense|Reverse journal entry)$/;

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function uiLogin(page: Page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder(/enter your phone/i).waitFor({ state: 'visible', timeout: 90000 });
  await page.getByPlaceholder(/enter your phone/i).fill(owner.phone);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByPlaceholder(/enter your password/i).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByPlaceholder(/enter your password/i).fill(owner.password);
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45000 });
  // New accounts get a welcome tour overlay that intercepts clicks.
  await page.addLocatorHandler(page.getByRole('button', { name: /No thanks/ }), async (btn) => {
    await btn.click();
  });
}

test.beforeAll(async ({ request }) => {
  test.skip(!hasDbConfig(), 'Postgres required');
  baseUrl = await discoverBaseUrl();
  const biz = await provisionRbacBusiness(request, baseUrl);
  owner = biz.owner;
  cleanup = biz.cleanup;
});

test.afterAll(async () => {
  if (cleanup) await cleanup();
});

test.describe('purchases', () => {
  let cancelBodies: Array<Record<string, unknown>> = [];
  let nextCancel: { status: number; body: unknown } = { status: 200, body: { success: true } };
  let deleteCalls: string[] = [];

  test.beforeEach(async ({ page }) => {
    cancelBodies = [];
    deleteCalls = [];
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.route(
      (url) => url.pathname === '/api/purchases',
      (route) =>
        route.request().method() === 'GET'
          ? json(route, 200, { purchases: PURCHASES, pagination: { page: 1, limit: 50, total: 4, totalPages: 1 } })
          : route.continue()
    );
    await page.route(/\/api\/purchases\/[^/]+\/cancel$/, async (route) => {
      cancelBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await json(route, nextCancel.status, nextCancel.body);
    });
    await page.route(/\/api\/purchases\/e2e-p-[a-z]+$/, async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      deleteCalls.push(route.request().url());
      await json(route, 200, {
        success: true,
        message: 'Purchase deleted successfully',
        supplier_balance_restored: 1250,
        mode: 'soft_deleted',
      });
    });
    await uiLogin(page);
  });

  test('actions follow status and cancelled bills are excluded from totals', async ({ page }) => {
    await page.goto(`${baseUrl}/purchases`);
    const table = page.locator('table');
    await expect(table.getByText('BILL-CANCELLED')).toBeVisible({ timeout: 60000 });

    const draftAction = page.getByTestId(`purchase-action-${P.draft}`).last();
    await expect(draftAction).toHaveText(/Delete draft/);
    await expect(draftAction).toBeEnabled();

    const openAction = page.getByTestId(`purchase-action-${P.open}`).last();
    await expect(openAction).toHaveText(/Cancel bill/);
    await expect(openAction).toBeEnabled();

    const paidAction = page.getByTestId(`purchase-action-${P.paid}`).last();
    await expect(paidAction).toHaveText(/Cancel bill/);
    await expect(paidAction).toBeDisabled();
    await expect(paidAction).toHaveAttribute(
      'title',
      /cannot be cancelled because a payment has already been recorded/
    );
    await expect(table.getByText(/Can't cancel: payment recorded/)).toBeVisible();

    await expect(page.getByTestId(`purchase-action-${P.cancelled}`)).toHaveCount(0);
    const cancelledRow = table.locator('tr', { hasText: 'BILL-CANCELLED' });
    await expect(cancelledRow).toContainText('Cancelled');
    await expect(cancelledRow).not.toContainText('Unpaid');
    await expect(cancelledRow.getByText('₹0', { exact: true }).last()).toHaveClass(/text-gray-400/);
    await expect(table.getByRole('button', { name: /^Delete$/ })).toHaveCount(0);

    await expect(page.getByText('₹1,700', { exact: true })).toBeVisible();
    await expect(page.getByText('₹500', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('₹1,200', { exact: true })).toBeVisible();
    await expect(page.getByText('₹11,699')).toHaveCount(0);

    await page.screenshot({ path: 'test-results/accounting-ui/purchases-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId(`purchase-action-${P.open}`).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/accounting-ui/purchases-mobile.png', fullPage: true });
  });

  test('unpaid filter excludes cancelled bills', async ({ page }) => {
    await page.goto(`${baseUrl}/purchases?status=unpaid`);
    const table = page.locator('table');
    await expect(table.getByText('BILL-OPEN')).toBeVisible({ timeout: 60000 });
    await expect(table.getByText('BILL-CANCELLED')).toHaveCount(0);
    await expect(table.getByText('BILL-PAID')).toHaveCount(0);
  });

  test('cancel requires a reason, sends no cancelled_by, and maps blocker codes', async ({ page }) => {
    await page.goto(`${baseUrl}/purchases`);
    await page.getByTestId(`purchase-action-${P.open}`).last().click({ timeout: 60000 });

    const dialog = page.getByRole('dialog', { name: DIALOG_TITLE });
    await expect(dialog).toContainText('accounting entries for this bill will be reversed');
    await expect(dialog).toContainText('remain as a cancelled record');

    await dialog.getByRole('button', { name: 'Cancel bill' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(/Please enter a reason for cancellation/);
    expect(cancelBodies).toHaveLength(0);

    await dialog.getByLabel(/Reason for cancellation/).fill('Entered twice');

    const cases: Array<[string, RegExp]> = [
      ['PURCHASE_HAS_PAYMENTS', /cannot be cancelled because a payment has already been recorded/],
      ['PURCHASE_HAS_RETURNS', /cannot be cancelled because a purchase return has already been recorded/],
      ['BILL_TDS_DEPOSITED', /cannot be cancelled because its TDS has already been deposited/],
      ['PURCHASE_STOCK_CONSUMED', /cannot be cancelled because the purchased stock has already been consumed or sold/],
    ];
    for (const [code, message] of cases) {
      nextCancel = { status: 409, body: { error: `raw ${code} void refund`, code } };
      await dialog.getByRole('button', { name: 'Cancel bill' }).click();
      await expect(dialog.getByRole('alert')).toHaveText(message);
      await expect(dialog.getByRole('alert')).not.toContainText(/void|refund/i);
    }

    nextCancel = { status: 403, body: { error: 'raw', code: 'PERIOD_LOCKED' } };
    await dialog.getByRole('button', { name: 'Cancel bill' }).click();
    await expect(dialog.getByRole('alert')).toContainText('This accounting period is locked');
    await expect(dialog.getByRole('link', { name: 'Manage period locks' })).toHaveAttribute('href', '/settings/period-locks');

    nextCancel = { status: 200, body: { success: true, reversedLines: 4 } };
    await dialog.getByRole('button', { name: 'Cancel bill' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Bill cancelled. Its accounting entries have been reversed.')).toBeVisible();

    expect(cancelBodies.length).toBe(cases.length + 2);
    for (const body of cancelBodies) {
      expect(body).toEqual({ reason: 'Entered twice' });
      expect(body).not.toHaveProperty('cancelled_by');
    }
  });

  test('draft delete confirms and reports the supplier balance adjustment', async ({ page }) => {
    await page.goto(`${baseUrl}/purchases`);
    await page.getByTestId(`purchase-action-${P.draft}`).last().click({ timeout: 60000 });
    const dialog = page.getByRole('dialog', { name: DIALOG_TITLE });
    await expect(dialog).toContainText('Delete draft bill');
    await expect(dialog).toContainText('This draft bill will be deleted');
    await dialog.getByRole('button', { name: 'Delete draft' }).click();
    await expect(page.getByText('Draft deleted. Supplier balance adjusted by ₹1,250.')).toBeVisible();
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toContain(`/api/purchases/${P.draft}`);
  });
});

test.describe('expenses and journals', () => {
  const deleteUrls: string[] = [];
  let nextDelete: { status: number; body: unknown } = { status: 200, body: { success: true } };

  test.beforeEach(async ({ page }) => {
    deleteUrls.length = 0;
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.route(
      (url) => url.pathname === '/api/expenses',
      (route) =>
        route.request().method() === 'GET'
          ? json(route, 200, {
              expenses: [
                {
                  id: 'e2e-exp-1',
                  amount: 750,
                  description: 'E2E Office rent',
                  expense_date: '2026-09-02',
                  payment_mode: 'cash',
                  category_name: 'Rent',
                  category_id: null,
                },
              ],
            })
          : route.continue()
    );
    await page.route(
      (url) => url.pathname === '/api/journal-entries',
      (route) =>
        route.request().method() === 'GET'
          ? json(route, 200, {
              entries: [
                { voucher_id: 'e2e-jv-1', voucher_number: 'JV-E2E-1', entry_date: '2026-09-03', total_debit: 300, total_credit: 300, line_count: 2 },
                { voucher_id: 'e2e-jv-2', voucher_number: 'JV-E2E-2', entry_date: '2026-09-03', total_debit: 90, total_credit: 90, line_count: 2, is_locked: true },
              ],
              pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
            })
          : route.continue()
    );
    await page.route(/\/api\/(expenses|journal-entries)\/e2e-[a-z0-9-]+\?/, async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      deleteUrls.push(route.request().url());
      await json(route, nextDelete.status, nextDelete.body);
    });
    await uiLogin(page);
  });

  test('expense delete is a reversal with a reason and mapped lock errors', async ({ page }) => {
    await page.goto(`${baseUrl}/expenses`);
    await page.getByRole('button', { name: 'Reverse' }).click({ timeout: 60000 });

    const dialog = page.getByRole('dialog', { name: DIALOG_TITLE });
    await expect(dialog).toContainText('will be reversed by posting corresponding reversing entries');
    await expect(dialog).toContainText('The original entry will remain available for audit history.');
    await expect(dialog).not.toContainText(/ledger entries (will be )?(deleted|removed)/i);

    await dialog.getByRole('button', { name: 'Reverse entry' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(/Please enter a reason for reversal/);
    expect(deleteUrls).toHaveLength(0);

    await dialog.getByLabel(/Reason for reversal/).fill('Duplicate entry');

    nextDelete = { status: 403, body: { error: 'raw lock', code: 'PERIOD_LOCKED' } };
    await dialog.getByRole('button', { name: 'Reverse entry' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'This accounting period is locked, so this correction cannot be made.'
    );

    nextDelete = { status: 403, body: { error: 'raw gst', code: 'GST_PERIOD_FILED' } };
    await dialog.getByRole('button', { name: 'Reverse entry' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'This GST period has already been filed, so this correction cannot be made directly.'
    );

    nextDelete = { status: 200, body: { success: true } };
    await dialog.getByRole('button', { name: 'Reverse entry' }).click();
    await expect(page.getByText('Entry reversed successfully.')).toBeVisible();
    await expect(page.getByText(/Ledger entries deleted|Expense deleted/)).toHaveCount(0);

    expect(deleteUrls).toHaveLength(3);
    for (const url of deleteUrls) {
      const u = new URL(url);
      expect(u.pathname).toBe('/api/expenses/e2e-exp-1');
      expect(u.searchParams.get('reason')).toBe('Duplicate entry');
    }
  });

  test('journal delete is a reversal with a reason and mapped lock errors', async ({ page }) => {
    await page.goto(`${baseUrl}/journal-entries`);
    await expect(page.getByTestId('journal-reverse-e2e-jv-2')).toBeDisabled({ timeout: 60000 });
    await expect(page.getByTestId('journal-reverse-e2e-jv-2')).toHaveAttribute('title', /locked/i);

    await page.getByTestId('journal-reverse-e2e-jv-1').click();
    const dialog = page.getByRole('dialog', { name: DIALOG_TITLE });
    await expect(dialog).toContainText('will be reversed by posting corresponding reversing entries');
    await expect(dialog).toContainText('The original entry will remain available for audit history.');

    await dialog.getByRole('button', { name: 'Reverse entry' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(/Please enter a reason for reversal/);
    expect(deleteUrls).toHaveLength(0);

    await dialog.getByLabel(/Reason for reversal/).fill('Wrong account');

    const cases: Array<[number, string, string]> = [
      [403, 'PERIOD_LOCKED', 'This accounting period is locked, so this correction cannot be made.'],
      [403, 'GST_PERIOD_FILED', 'This GST period has already been filed, so this correction cannot be made directly.'],
      [403, 'JOURNAL_LOCKED', 'This journal entry is locked. Unlock it before it can be reversed.'],
      [401, '', 'Your session has expired. Log in again to continue.'],
    ];
    for (const [status, code, message] of cases) {
      nextDelete = { status, body: code ? { error: 'raw', code } : { error: 'Unauthorized' } };
      await dialog.getByRole('button', { name: 'Reverse entry' }).click();
      await expect(dialog.getByRole('alert')).toContainText(message);
    }
    await expect(dialog.getByRole('link', { name: 'Log in again' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Fjournal-entries'
    );

    nextDelete = { status: 200, body: { message: 'Journal entry deleted successfully' } };
    await dialog.getByRole('button', { name: 'Reverse entry' }).click();
    await expect(page.getByText('Entry reversed successfully.')).toBeVisible();

    expect(deleteUrls).toHaveLength(cases.length + 1);
    for (const url of deleteUrls) {
      const u = new URL(url);
      expect(u.pathname).toBe('/api/journal-entries/e2e-jv-1');
      expect(u.searchParams.get('reason')).toBe('Wrong account');
    }
    await page.screenshot({ path: 'test-results/accounting-ui/journal-reverse.png', fullPage: true });
  });
});
