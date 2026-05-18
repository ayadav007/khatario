import { test as base, Page } from '@playwright/test';

/**
 * Login helper - requires E2E_TEST_PHONE and E2E_TEST_PASSWORD in env
 */
export async function loginAsTestUser(page: Page) {
  const phone = process.env.E2E_TEST_PHONE;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!phone || !password) {
    throw new Error(
      'E2E tests require E2E_TEST_PHONE and E2E_TEST_PASSWORD. ' +
      'Add them to .env.local or run: E2E_TEST_PHONE=xxx E2E_TEST_PASSWORD=xxx npm run test:e2e'
    );
  }

  await page.goto('/login');
  // Wait for login form to be ready (handles slow initial load / DB errors)
  await page.getByPlaceholder(/enter your phone/i).waitFor({ state: 'visible', timeout: 60000 });
  await page.getByPlaceholder(/enter your phone/i).fill(phone);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByPlaceholder(/enter your password/i).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByPlaceholder(/enter your password/i).fill(password);
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await loginAsTestUser(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
