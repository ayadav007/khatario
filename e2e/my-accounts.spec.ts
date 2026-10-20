import { test, expect, type Page } from './fixtures/auth';

async function hideSchedule(page: Page) {
  const hide = page.getByRole('button', { name: 'Hide schedule' });
  if (await hide.isVisible().catch(() => false)) await hide.click();
}

test.describe('My Accounts tab', () => {
  test.describe.configure({ timeout: 300000 });
  test('shows posted accounts and a manual pin without posting', async ({ authenticatedPage: page }) => {
    const stamp = Date.now().toString().slice(-8);
    const parentName = `Mine Parent ${stamp}`;
    const childName = `Mine Child ${stamp}`;
    const idleName = `Mine Idle ${stamp}`;
    const spareName = `Mine Spare ${stamp}`;
    const parentCode = `MP${stamp}`;
    const childCode = `MC${stamp}`;
    const idleCode = `MI${stamp}`;
    const spareCode = `MS${stamp}`;
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText || 'failed';
      if (failure.includes('ERR_ABORTED')) return;
      failedRequests.push(`${request.method()} ${request.url()} ${failure}`);
    });
    const created: string[] = [];

    const session = await page.request.get('/api/auth/session');
    expect(session.ok()).toBeTruthy();
    const userId = ((await session.json()).user as { id: string }).id;
    const groups = await page.request.get('/api/accounts/groups');
    expect(groups.ok()).toBeTruthy();
    const expenseGroup = ((await groups.json()).groups as Array<{ id: string; group_code: string }>).find(
      (group) => group.group_code === '5200',
    );
    expect(expenseGroup).toBeTruthy();
    async function create(code: string, name: string, parentId?: string, opening = 0) {
      const res = await page.request.post('/api/accounts', {
        data: {
          created_by: userId,
          account_code: code,
          account_name: name,
          account_type: 'expense',
          account_group_id: expenseGroup!.id,
          nature: 'debit',
          opening_balance: opening,
          opening_balance_type: 'debit',
          parent_account_id: parentId ?? null,
        },
      });
      expect(res.status(), await res.text()).toBe(201);
      const id = ((await res.json()).account as { id: string }).id;
      created.push(id);
      return id;
    }

    try {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/accounts');
      await expect(page.getByRole('tab', { name: 'My Accounts' })).toHaveAttribute('aria-selected', 'true', {
        timeout: 30000,
      });
      const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(fits).toBe(true);

      await page.setViewportSize({ width: 1280, height: 900 });
      await hideSchedule(page);
      const parentId = await create(parentCode, parentName);
      await create(childCode, childName, parentId, 15);
      await create(idleCode, idleName);
      await create(spareCode, spareName);

      await page.reload();
      await expect(page.getByTestId(`my-account-${childCode}`)).toContainText(childName, { timeout: 20000 });
      await expect(page.getByTestId(`my-account-${childCode}`)).toContainText('Dr ₹15.00');
      await expect(page.getByTestId(`my-account-${parentCode}`)).toContainText('No posted entries on this account');
      await expect(page.getByTestId(`my-account-${idleCode}`)).toHaveCount(0);
      await page.getByRole('button', { name: `Collapse ${parentName}` }).click();
      await expect(page.getByTestId(`my-account-${childCode}`)).toHaveCount(0);
      await page.getByRole('button', { name: `Expand ${parentName}` }).click();
      await expect(page.getByTestId(`my-account-${childCode}`)).toBeVisible();

      await page.getByRole('button', { name: 'Add Accounts' }).click();
      const preview = page.getByRole('dialog', { name: 'Add accounts' });
      await expect(preview.getByLabel('Search accounts to add')).toBeVisible();
      await expect(preview.locator('.animate-spin')).toHaveCount(0, { timeout: 20000 });
      await preview.getByLabel('Search accounts to add').fill(childName);
      const childChoice = preview.getByRole('checkbox', { name: new RegExp(childName) });
      await expect(childChoice).toBeVisible({ timeout: 20000 });
      await expect(preview.getByText('Already shown')).toBeVisible();
      await expect(childChoice).toBeDisabled();
      await preview.getByRole('button', { name: 'Cancel' }).click();

      await page.getByRole('button', { name: 'Add Accounts' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add accounts' });
      await dialog.getByLabel('Search accounts to add').fill(`Mine ${stamp}`);
      await dialog.getByRole('checkbox', { name: new RegExp(idleName) }).check();
      await dialog.getByRole('checkbox', { name: new RegExp(spareName) }).check();
      await dialog.getByRole('button', { name: 'Add to My Accounts' }).click();
      await expect(dialog).toBeHidden({ timeout: 20000 });
      await expect(page.getByTestId(`my-account-${idleCode}`)).toContainText('Added by you');
      await expect(page.getByTestId(`my-account-${spareCode}`)).toContainText('Added by you');

      await page.reload();
      await expect(page.getByTestId(`my-account-${idleCode}`)).toBeVisible({ timeout: 20000 });
      await page.getByTestId(`my-account-${idleCode}`).getByRole('button', { name: 'Remove' }).click();
      await expect(page.getByText('Removed from My Accounts')).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId(`my-account-${idleCode}`)).toHaveCount(0);
      await expect(page.getByTestId(`my-account-${childCode}`)).toBeVisible();

      const idleLines = await page.request.get(`/api/accounts?search=${idleCode}`);
      const idleRow = ((await idleLines.json()).accounts as Array<{ account_code: string; opening_balance: string | number }>).find(
        (row) => row.account_code === idleCode,
      );
      expect(Number(idleRow?.opening_balance || 0)).toBe(0);

      await page.getByRole('tab', { name: 'All Accounts' }).click();
      await expect(page.getByPlaceholder('Search accounts...')).toBeVisible();
      await expect(page.getByRole('button', { name: 'List' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tree' })).toBeVisible();
      await page.getByPlaceholder('Search accounts...').fill(childCode);
      await expect(page.getByRole('cell', { name: childName })).toBeVisible({ timeout: 15000 });
      const desktopFits = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(desktopFits).toBe(true);
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
      expect(failedRequests, failedRequests.join('\n')).toEqual([]);
    } finally {
      for (const id of [...created].reverse()) {
        await page.request.delete(`/api/accounts/${id}`);
      }
    }
  });
});
