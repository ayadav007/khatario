import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

/**
 * Staging browser project only. The shared playwright.config.ts stays on localhost.
 *
 * STAGING_TEST_BUSINESS must name the designated test business.
 * npx playwright test --config=playwright.staging.config.ts
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /phase3q-staging-browser\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180000,
  reporter: 'line',
  use: {
    baseURL: 'https://staging.khatario.com',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'staging-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
