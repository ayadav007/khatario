import { test, expect, type BrowserContext } from '@playwright/test';
import { SignJWT } from 'jose';
import { discoverBaseUrl } from './helpers/discover-base-url';
import { hasDbConfig, withDbClient } from './helpers/db';

test.describe.configure({ mode: 'serial' });

type PageSnapshot = {
  draft_data: unknown;
  draft_updated_at: Date | null;
  draft_updated_by: string | null;
  published_data: unknown;
  published_at: Date | null;
  published_by: string | null;
} | null;

const COOKIE = 'khatario_platform_session';
const STAMP = `E2E site builder ${Date.now()}`;
const SECRET = process.env.PLATFORM_JWT_SECRET || process.env.JWT_SECRET || '';

let baseUrl = '';
let adminId = '';
let token = '';
let snapshot: PageSnapshot = null;

async function authedContext(browser: import('@playwright/test').Browser, opts = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext(opts);
  const url = new URL(baseUrl);
  await ctx.addCookies([
    { name: COOKIE, value: token, domain: url.hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  return ctx;
}

function testDocument() {
  return {
    root: { props: { title: '', description: '', ogImage: '', brandColor: 'teal', headingFont: 'default' } },
    content: [
      {
        type: 'Section',
        props: {
          id: 'Section-e2e',
          background: 'tint',
          width: 'wide',
          paddingY: 'lg',
          content: [
            { type: 'Heading', props: { id: 'Heading-e2e', text: STAMP, level: 'h1', size: 'display', align: 'center' } },
            { type: 'Text', props: { id: 'Text-e2e', text: 'Built in the **Site Builder** e2e test.', align: 'center' } },
          ],
        },
      },
      { type: 'Faq', props: { id: 'Faq-e2e' } },
    ],
  };
}

test.beforeAll(async () => {
  test.skip(!hasDbConfig(), 'Postgres required');
  test.skip(!SECRET, 'PLATFORM_JWT_SECRET or JWT_SECRET required');
  baseUrl = await discoverBaseUrl();

  await withDbClient(async (c) => {
    await c.query(`INSERT INTO marketing_pages (slug) VALUES ('home') ON CONFLICT (slug) DO NOTHING`);
    const page = await c.query(
      `SELECT draft_data, draft_updated_at, draft_updated_by, published_data, published_at, published_by
       FROM marketing_pages WHERE slug = 'home'`,
    );
    snapshot = page.rows[0] ?? null;
    const admin = await c.query(
      `INSERT INTO platform_admins (name, email, password_hash, role, is_active)
       VALUES ('E2E Site Builder', $1, 'e2e-no-login', 'super_admin', true)
       RETURNING id, auth_session_version`,
      [`e2e-site-builder-${Date.now()}@example.test`],
    );
    adminId = admin.rows[0].id;
    token = await new SignJWT({ adminId, type: 'platform_access', sv: admin.rows[0].auth_session_version })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
  });
});

test.afterAll(async () => {
  if (!adminId) return;
  await withDbClient(async (c) => {
    await c.query(`DELETE FROM marketing_page_versions WHERE published_by = $1`, [adminId]);
    if (snapshot) {
      await c.query(
        `UPDATE marketing_pages
         SET draft_data = $1, draft_updated_at = $2, draft_updated_by = $3,
             published_data = $4, published_at = $5, published_by = $6, updated_at = NOW()
         WHERE slug = 'home'`,
        [
          snapshot.draft_data === null ? null : JSON.stringify(snapshot.draft_data),
          snapshot.draft_updated_at,
          snapshot.draft_updated_by,
          snapshot.published_data === null ? null : JSON.stringify(snapshot.published_data),
          snapshot.published_at,
          snapshot.published_by,
        ],
      );
    }
    await c.query(`DELETE FROM platform_admin_logs WHERE admin_id = $1`, [adminId]);
    await c.query(`DELETE FROM platform_admins WHERE id = $1`, [adminId]);
  });
});

test('builder APIs reject requests without a platform session', async ({ playwright }) => {
  const api = await playwright.request.newContext();
  const draft = await api.put(`${baseUrl}/api/admin/marketing/pages/home`, { data: { data: testDocument() } });
  expect(draft.status()).toBe(401);
  const publish = await api.post(`${baseUrl}/api/admin/marketing/pages/home/publish`, { data: { data: testDocument() } });
  expect(publish.status()).toBe(401);
  const preview = await api.get(`${baseUrl}/admin/site-builder/preview`, { maxRedirects: 0 });
  expect([302, 307, 308, 404]).toContain(preview.status());
  await api.dispose();
});

test('draft saves are sanitized and unknown blocks are refused', async ({ browser }) => {
  const ctx = await authedContext(browser);
  const bad = await ctx.request.put(`${baseUrl}/api/admin/marketing/pages/home`, {
    data: { data: { root: { props: {} }, content: [{ type: 'Script', props: { id: 'x' } }] }, force: true },
  });
  expect(bad.status()).toBe(422);
  await ctx.close();
});

test('edit draft, publish, and see it live', async ({ browser }) => {
  test.setTimeout(420_000);
  const ctx = await authedContext(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const saved = await page.request.put(`${baseUrl}/api/admin/marketing/pages/home`, {
    data: { data: testDocument(), force: true },
  });
  expect(saved.status()).toBe(200);

  await page.goto(`${baseUrl}/admin/site-builder`, { timeout: 300_000 });
  await expect(page.getByTestId('site-builder-save-status')).toBeVisible({ timeout: 300_000 });
  const canvas = page.frameLocator('iframe').first();
  await expect(canvas.getByRole('heading', { name: STAMP })).toBeVisible({ timeout: 120_000 });

  const preview = await page.request.get(`${baseUrl}/admin/site-builder/preview`, { timeout: 300_000 });
  expect(preview.status()).toBe(200);
  expect(await preview.text()).toContain(STAMP);

  const live = await page.request.get(`${baseUrl}/`, { timeout: 300_000 });
  expect(await live.text()).not.toContain(STAMP);

  page.once('dialog', (d) => void d.accept());
  const publishResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/marketing/pages/home/publish') && r.request().method() === 'POST',
  );
  await page.getByTestId('site-builder-publish').click();
  expect((await publishResponse).status()).toBe(200);

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('dialog').getByText('Live')).toBeVisible({ timeout: 30_000 });

  const home = await ctx.newPage();
  await home.goto(`${baseUrl}/`, { timeout: 300_000 });
  await expect(home.getByRole('heading', { name: STAMP })).toBeVisible({ timeout: 60_000 });
  await ctx.close();
});

test('published home page has no horizontal scroll on a phone', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${baseUrl}/`, { timeout: 300_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await ctx.close();
});
