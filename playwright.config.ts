import { config } from 'dotenv';

// Load .env.local or .env for E2E_TEST_PHONE, E2E_TEST_PASSWORD
config({ path: '.env.local' });
config({ path: '.env' });

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for Khatario
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
  },
  timeout: 60000,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      ...process.env,
      // Lets full-journey signup repeat without 429 when Playwright starts this server.
      E2E_DISABLE_RATE_LIMIT: 'true',
    },
  },
});
