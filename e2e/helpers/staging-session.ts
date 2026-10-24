import fs from 'fs';
import path from 'path';
import type { Page, TestInfo } from '@playwright/test';

export const STAGING_ORIGIN = 'https://staging.khatario.com';
export const STAGING_HOST = 'staging.khatario.com';
export const LOGIN_RATE_LIMIT = 'Too many login attempts. Please try again later.';

export type CreatedRecord = {
  kind: 'customer' | 'item' | 'invoice' | 'supplier' | 'purchase' | 'purchase_return';
  name: string;
  invoiceNumber?: string;
};

const created: CreatedRecord[] = [];

export function rememberRecord(record: CreatedRecord) {
  created.push(record);
  console.log(`RECORD ${record.kind} ${record.name}${record.invoiceNumber ? ` ${record.invoiceNumber}` : ''}`);
}

export function createdRecords(): CreatedRecord[] {
  return created.slice();
}

export function writeRecordLedger() {
  if (created.length === 0) return;
  const dir = path.join(process.cwd(), 'test-results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'phase3q-staging-records.json');
  fs.writeFileSync(file, JSON.stringify(created, null, 2));
}

/** Stop before any form submit when the staging account or host is not explicit. */
export function stagingConfigBlock(testInfo: TestInfo): string | null {
  const baseURL = String(testInfo.project.use.baseURL || '');
  let host = '';
  try {
    host = new URL(baseURL).hostname;
  } catch {
    host = '';
  }
  if (host !== STAGING_HOST) {
    return 'BLOCKED: run this file with playwright.staging.config.ts so the host is staging.khatario.com';
  }
  if (!process.env.STAGING_TEST_BUSINESS || !process.env.E2E_TEST_PHONE || !process.env.E2E_TEST_PASSWORD) {
    return 'BLOCKED: set STAGING_TEST_BUSINESS, E2E_TEST_PHONE, and E2E_TEST_PASSWORD before a mutating staging run';
  }
  return null;
}

/**
 * One login. If staging shows the rate-limit message, return it and do not click Login again.
 */
export async function signInOnce(page: Page): Promise<string | null> {
  const phone = process.env.E2E_TEST_PHONE || '';
  const password = process.env.E2E_TEST_PASSWORD || '';
  const business = process.env.STAGING_TEST_BUSINESS || '';
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (new URL(page.url()).hostname !== STAGING_HOST) {
    return `BLOCKED: page host is not ${STAGING_HOST}`;
  }
  const rateLimit = page.getByText(LOGIN_RATE_LIMIT);
  if (await rateLimit.isVisible().catch(() => false)) {
    return `BLOCKED: ${LOGIN_RATE_LIMIT}`;
  }

  await page.getByPlaceholder(/enter your phone/i).waitFor({ state: 'visible', timeout: 120000 });
  await page.getByPlaceholder(/enter your phone/i).fill(phone);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByPlaceholder(/enter your password/i).waitFor({ state: 'visible', timeout: 20000 });
  if (await rateLimit.isVisible().catch(() => false)) {
    return `BLOCKED: ${LOGIN_RATE_LIMIT}`;
  }
  await page.getByPlaceholder(/enter your password/i).fill(password);
  await page.getByRole('button', { name: /^login$/i }).click();

  const outcome = await page.waitForFunction(
    (message) => {
      const text = document.body?.innerText || '';
      if (text.includes(message)) return 'limited';
      if (!location.pathname.startsWith('/login')) return 'ok';
      return '';
    },
    LOGIN_RATE_LIMIT,
    { timeout: 90000, polling: 200 },
  );
  if ((await outcome.jsonValue()) === 'limited') {
    return `BLOCKED: ${LOGIN_RATE_LIMIT}`;
  }

  const session = await page.evaluate(async () => {
    const res = await fetch('/api/auth/session', { credentials: 'include' });
    const json = await res.json();
    return {
      status: res.status,
      businessName: json.business?.name || '',
      isPrimaryAdmin: Boolean(json.isPrimaryAdmin),
    };
  });
  if (session.status !== 200 || session.businessName !== business) {
    return 'BLOCKED: signed-in business is not STAGING_TEST_BUSINESS';
  }
  if (!session.isPrimaryAdmin) {
    return 'BLOCKED: the staging account is not the primary admin of the designated business';
  }
  console.log(`signed in to ${session.businessName}`);
  return null;
}
