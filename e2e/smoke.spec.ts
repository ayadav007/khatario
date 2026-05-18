import { test, expect } from './fixtures/auth';

/**
 * Smoke tests: primary admin can access main routes without Access Denied
 */
test.describe('Smoke - main routes', () => {
  test('dashboard loads after login', async ({ authenticatedPage: page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/access denied/i)).not.toBeVisible();
  });

  test('invoices list loads', async ({ authenticatedPage: page }) => {
    await page.goto('/invoices');
    await expect(page).toHaveURL(/\/invoices/);
    await expect(page.getByText(/access denied/i)).not.toBeVisible();
  });

  test('invoices new page loads (create)', async ({ authenticatedPage: page }) => {
    await page.goto('/invoices/new');
    await expect(page).toHaveURL(/\/invoices\/new/);
    await expect(page.getByText(/access denied/i)).not.toBeVisible();
  });

  test('customers list loads', async ({ authenticatedPage: page }) => {
    await page.goto('/customers');
    await expect(page).toHaveURL(/\/customers/);
    await expect(page.getByText(/access denied/i)).not.toBeVisible();
  });

  test('items list loads', async ({ authenticatedPage: page }) => {
    await page.goto('/items');
    await expect(page).toHaveURL(/\/items/);
    await expect(page.getByText(/access denied/i)).not.toBeVisible();
  });

  test('settings loads', async ({ authenticatedPage: page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByText(/access denied/i)).not.toBeVisible();
  });
});
