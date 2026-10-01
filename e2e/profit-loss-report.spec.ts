import { test, expect, type Page, type Route } from '@playwright/test';
import { discoverBaseUrl } from './helpers/discover-base-url';
import { hasDbConfig } from './helpers/db';
import { provisionRbacBusiness, type RbacPersona } from './helpers/subscription-rbac-personas';

/**
 * Profit & Loss page (Zoho layout): sections in order, lines adding up to each section total,
 * sub-account nesting and the "Hide sub-accounts" roll-up, section collapse, the ledger check
 * footer, and the Excel export link. The report API is intercepted with a fixed response.
 */

test.describe.configure({ mode: 'serial' });

let baseUrl = '';
let owner: RbacPersona;
let cleanup: (() => Promise<void>) | null = null;

type Node = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_group_name: string | null;
  is_active: boolean;
  section: string;
  amount: number;
  total: number;
  children: Node[];
};

const node = (section: string, code: string, name: string, amount: number, children: Node[] = [], isActive = true): Node => ({
  id: `e2e-${code}`,
  account_code: code,
  account_name: name,
  account_type: section.includes('income') ? 'income' : 'expense',
  account_group_name: null,
  is_active: isActive,
  section,
  amount,
  total: amount + children.reduce((s, c) => s + c.total, 0),
  children,
});

const block = (key: string, label: string, accounts: Node[], extra = 0) => ({
  key,
  label,
  total: accounts.reduce((s, a) => s + a.total, 0) + extra,
  accounts,
});

const SCHEDULE = { opening_stock: 1000, purchases: 4000, closing_stock: 1500, cost_of_goods_sold: 3500 };
const SECTIONS = [
  block('operating_income', 'Operating Income', [
    node('operating_income', '4101', 'Sales', 20000),
    node('operating_income', '5299', 'Round Off', -2),
  ]),
  block('cost_of_goods_sold', 'Cost of Goods Sold', [node('cost_of_goods_sold', '5104', 'Freight Inward', 200)], SCHEDULE.cost_of_goods_sold),
  block('operating_expense', 'Operating Expense', [
    node('operating_expense', '5201', 'Rent', 1000, [
      node('operating_expense', '5201-1', 'Godown Rent', 400),
      node('operating_expense', '5201-2', 'Office Rent', 600),
    ]),
    node('operating_expense', '4102', 'Discount Received', -150),
    node('operating_expense', '5905', 'Old Expense', 300, [], false),
  ]),
  block('other_income', 'Non Operating Income', [node('other_income', '4203', 'Dividend Income', 500)]),
  block('other_expense', 'Non Operating Expense', [node('other_expense', '5210', 'Current Tax', 900)]),
];
const total = (k: string) => SECTIONS.find((s) => s.key === k)!.total;
const GROSS = total('operating_income') - total('cost_of_goods_sold');
const OPERATING = GROSS - total('operating_expense');
const NET = OPERATING + total('other_income') - total('other_expense');

const PL_RESPONSE = {
  period: { from_date: '2026-04-01', to_date: '2026-09-30', financial_year: '2026-27' },
  branch: null,
  is_consolidated: true,
  sections: SECTIONS,
  gross_profit: GROSS,
  operating_profit: OPERATING,
  net_profit: NET,
  elimination: { applied: false, net: 0, accounts: [] },
  inventory_model: 'periodic',
  periodic_cogs: SCHEDULE,
  ledger_check: { ledger_net: NET - 500, inventory_adjustment: 500, difference: 0 },
  warnings: [],
};

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function uiLogin(page: Page) {
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder(/enter your phone/i).waitFor({ state: 'visible', timeout: 90000 });
  await page.getByPlaceholder(/enter your phone/i).fill(owner.phone);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByPlaceholder(/enter your password/i).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByPlaceholder(/enter your password/i).fill(owner.password);
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45000 });
  await page.addLocatorHandler(page.getByRole('button', { name: /No thanks/ }), async (btn) => {
    await btn.click();
  });
}

const values = async (page: Page, scope: string, testId: string) =>
  (await page.getByTestId(scope).getByTestId(testId).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-value')))));
const sum = (ns: number[]) => Math.round(ns.reduce((s, n) => s + n, 0) * 100) / 100;

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

test.describe('profit and loss report', () => {
  let plRequests: URL[] = [];

  test.beforeEach(async ({ page }) => {
    plRequests = [];
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.route(
      (url) => url.pathname === '/api/reports/profit-loss',
      async (route) => {
        plRequests.push(new URL(route.request().url()));
        await json(route, PL_RESPONSE);
      }
    );
    await uiLogin(page);
    await page.goto(`${baseUrl}/reports/profit-loss`);
    await expect(page.getByTestId('pl-section-operating_income')).toBeVisible({ timeout: 60000 });
  });

  test('sections render in Zoho order and every section adds up', async ({ page }) => {
    const order = await page.locator('[data-testid^="pl-section-"]:not([data-testid^="pl-section-total"])').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid'))
    );
    expect(order).toEqual([
      'pl-section-operating_income',
      'pl-section-cost_of_goods_sold',
      'pl-section-operating_expense',
      'pl-section-other_income',
      'pl-section-other_expense',
    ]);

    for (const s of SECTIONS) {
      const scope = `pl-section-${s.key}`;
      const shown = Number(await page.getByTestId(`pl-section-total-${s.key}`).getAttribute('data-value'));
      expect(shown).toBe(s.total);
      const lines = sum([...(await values(page, scope, 'pl-root-amount')), ...(await values(page, scope, 'pl-child-amount'))]);
      const schedule = s.key === 'cost_of_goods_sold' ? SCHEDULE.cost_of_goods_sold : 0;
      expect(sum([lines, schedule])).toBe(shown);
    }

    await expect(page.getByTestId('pl-profit-gross-profit')).toHaveAttribute('data-value', String(GROSS));
    await expect(page.getByTestId('pl-profit-operating-profit')).toHaveAttribute('data-value', String(OPERATING));
    await expect(page.getByTestId('pl-profit-net-profit-loss')).toHaveAttribute('data-value', String(NET));

    const cogs = page.getByTestId('pl-section-cost_of_goods_sold');
    await expect(cogs).toContainText('Opening Stock');
    await expect(cogs).toContainText('Less: Closing Stock');
    const opex = page.getByTestId('pl-section-operating_expense');
    await expect(opex).toContainText('Total for Rent');
    await expect(opex.locator('[data-testid="pl-account-row"]', { hasText: 'Old Expense' })).toContainText('Inactive');
    await expect(page.getByTestId('pl-ledger-check')).toContainText('Agrees with the ledger after the stock adjustment');
    await page.screenshot({ path: 'test-results/profit-loss/report.png', fullPage: true });
  });

  test('hide sub-accounts rolls children into the parent line', async ({ page }) => {
    const scope = 'pl-section-operating_expense';
    expect(await values(page, scope, 'pl-child-amount')).toHaveLength(2);

    await page.getByTestId('pl-hide-sub-accounts').check();
    expect(await values(page, scope, 'pl-child-amount')).toHaveLength(0);
    await expect(page.getByTestId(scope)).not.toContainText('Total for Rent');
    const roots = await values(page, scope, 'pl-root-amount');
    expect(roots).toContain(2000);
    expect(sum(roots)).toBe(total('operating_expense'));
  });

  test('collapsing a section hides its lines but keeps its total', async ({ page }) => {
    const opex = page.getByTestId('pl-section-operating_expense');
    const header = opex.getByRole('button', { name: 'Operating Expense', exact: true });
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(opex.getByTestId('pl-account-row')).toHaveCount(0);
    await expect(page.getByTestId('pl-section-total-operating_expense')).toBeVisible();
    await header.click();
    await expect(opex.getByTestId('pl-account-row')).toHaveCount(5);
  });

  test('show zero refetches and Excel export opens the export route', async ({ page }) => {
    await page.getByLabel('Show accounts with no transactions').check();
    await expect.poll(() => plRequests.some((u) => u.searchParams.get('include_zero') === 'true')).toBe(true);

    await page.context().route('**/api/reports/profit-loss/excel**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    );
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('pl-export-excel').click()]);
    const url = new URL(popup.url());
    expect(url.pathname).toBe('/api/reports/profit-loss/excel');
    expect(url.searchParams.get('from_date')).toBeTruthy();
    expect(url.searchParams.get('include_zero')).toBe('true');
    await popup.close();
  });
});
