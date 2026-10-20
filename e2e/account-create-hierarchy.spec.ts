import { test, expect, type Page } from './fixtures/auth';

async function showAllAccounts(page: Page) {
  const tab = page.getByRole('tab', { name: 'All Accounts' });
  await expect(tab).toBeVisible({ timeout: 30000 });
  await tab.click();
  await expect(page.getByPlaceholder('Search accounts...')).toBeVisible({ timeout: 20000 });
}

async function hideSchedule(page: Page) {
  const hide = page.getByRole('button', { name: 'Hide schedule' });
  if (await hide.isVisible().catch(() => false)) {
    await hide.click();
  }
}

async function chooseGroup(page: Page, query: string) {
  const box = page.getByRole('combobox', { name: /account type/i });
  await expect(box).toBeEnabled({ timeout: 20000 });
  await box.click();
  await box.fill(query);
  const option = page.getByRole('option', { name: new RegExp(query) });
  await expect(option).toBeVisible({ timeout: 20000 });
  await option.click();
}

async function removeAccount(page: Page, code: string) {
  const listed = await page.request.get(`/api/accounts?search=${encodeURIComponent(code)}`);
  if (!listed.ok()) return;
  const body = await listed.json();
  const account = (body.accounts || []).find((row: { account_code: string }) => row.account_code === code);
  if (!account) return;
  const removed = await page.request.delete(`/api/accounts/${account.id}`);
  if (!removed.ok() && removed.status() !== 404) {
    throw new Error(`Could not remove ${code}: ${removed.status()} ${await removed.text()}`);
  }
}

test.describe('Create account hierarchy', () => {
  test.describe.configure({ timeout: 300000 });
  test('creates a top-level account, a sub-account, and edits the parent', async ({ authenticatedPage: page }) => {
    const stamp = Date.now().toString().slice(-8);
    const parentName = `UX Parent ${stamp}`;
    const childName = `UX Child ${stamp}`;
    const parentCode = `UXP${stamp}`;
    const childCode = `UXC${stamp}`;

    try {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/accounts/new');
      await expect(page.getByRole('heading', { name: 'Add account' }).first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByPlaceholder('e.g. Electricity expense')).toBeVisible();
      await expect(page.getByText(/access denied/i)).toHaveCount(0);
      const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      );
      expect(fits).toBe(true);

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/accounts/new');
      await page.getByPlaceholder('e.g. Electricity expense').fill(parentName);
      await chooseGroup(page, 'Indirect Expenses');
      await expect(page.getByTestId('suggested-account-code')).toBeVisible({ timeout: 20000 });
      await page.getByPlaceholder(/suggested/i).fill(parentCode);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Chart of Accounts' })).toBeVisible({ timeout: 30000 });
      if (!/\/accounts\/?$/.test(new URL(page.url()).pathname)) await page.goto('/accounts');

      await showAllAccounts(page);
      await page.getByPlaceholder('Search accounts...').fill(parentCode);
      await expect(page.getByRole('cell', { name: parentName })).toBeVisible({ timeout: 30000 });
      await expect(page.getByText(`Sub-account of ${parentCode}`)).toHaveCount(0);

      await page.goto('/accounts/new');
      await page.getByPlaceholder('e.g. Electricity expense').fill(childName);
      await chooseGroup(page, 'Indirect Expenses');
      await page.getByPlaceholder(/suggested/i).fill(childCode);
      await page.getByRole('checkbox', { name: /make this a sub-account/i }).check();
      const parentBox = page.getByRole('combobox', { name: /parent account/i });
      await parentBox.click();
      await parentBox.fill(parentCode);
      await page.getByRole('option', { name: new RegExp(parentName) }).click();
      const path = page.getByTestId('parent-account-path');
      await expect(path).toContainText(parentName);
      await expect(path).toContainText('→');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Chart of Accounts' })).toBeVisible({ timeout: 30000 });
      if (!/\/accounts\/?$/.test(new URL(page.url()).pathname)) await page.goto('/accounts');

      await showAllAccounts(page);
      await page.getByPlaceholder('Search accounts...').fill(childCode);
      await expect(page.getByText(`Sub-account of ${parentCode} ${parentName}`)).toBeVisible({ timeout: 15000 });

      await page.getByRole('row', { name: new RegExp(childName) }).locator('a[href$="/edit"]').click();
      await expect(page.getByRole('button', { name: 'Clear parent' })).toBeVisible({ timeout: 20000 });
      await page.getByRole('button', { name: 'Clear parent' }).click();
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await page.waitForURL(/\/accounts\/[^/]+$/, { timeout: 30000 });

      await page.goto('/accounts');
      await showAllAccounts(page);
      await page.getByPlaceholder('Search accounts...').fill(childCode);
      await expect(page.getByRole('cell', { name: childName })).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(`Sub-account of ${parentCode} ${parentName}`)).toHaveCount(0);

      await page.getByRole('row', { name: new RegExp(childName) }).locator('a[href$="/edit"]').click();
      await hideSchedule(page);
      await page.getByRole('checkbox', { name: /make this a sub-account/i }).check({ timeout: 30000 });
      const editParent = page.getByRole('combobox', { name: /parent account/i });
      await editParent.click();
      await editParent.fill(parentCode);
      await page.getByRole('option', { name: new RegExp(parentName) }).click();
      await expect(page.getByTestId('parent-account-path')).toContainText(parentName);
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await page.waitForURL(/\/accounts\/[^/]+$/, { timeout: 30000 });

      await page.goto('/accounts');
      await showAllAccounts(page);
      await page.getByRole('button', { name: 'Tree' }).click();
      await page.getByPlaceholder('Search accounts...').fill(childName);
      await expect(page.getByText(childName)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('Sub-account').first()).toBeVisible();
    } finally {
      await removeAccount(page, childCode);
      await removeAccount(page, parentCode);
    }
  });
});
