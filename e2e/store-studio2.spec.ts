/**
 * Studio 2 store design editor, end to end (store engine M2).
 *
 * Local only: runs against a dev server on the disposable `kh_phase2_test` DB and the "Map Test Shop"
 * store (subdomain `ganesh`). Skipped unless STUDIO2_E2E=1. The spec talks to that DB directly to turn
 * `store_engine` on, reset the theme rows before each test and put everything back afterwards
 * (published theme, working draft, versions, `store_engine`), so run it through the test-DB wrapper:
 *
 *   STUDIO2_E2E=1 PLAYWRIGHT_BASE_URL=http://localhost:3015 PLAYWRIGHT_SKIP_WEBSERVER=1 \
 *     node .superpowers/sdd/2026-10-30-store-engine-m2-studio2-editor/with-test-db.js \
 *     npx playwright test e2e/store-studio2.spec.ts --project=chromium
 *
 * Login uses LOCAL_TEST_PHONE / LOCAL_TEST_PASSWORD from .env (the local Map Tester account) and keeps
 * its own storage state under e2e/.auth/ (git-ignored).
 */
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { test, expect, type Browser, type FrameLocator, type Page } from '@playwright/test';

config({ path: '.env' });

const BUSINESS_ID = '4b49ddef-59bc-4ec3-94c0-65f615ce32a3';
const SUBDOMAIN = 'ganesh';
const AUTH_FILE = path.join(__dirname, '.auth', 'studio2-local.json');
const SLOW = 90_000;

interface ThemeSnap {
  id: string;
  name: string;
  role: string;
  is_working: boolean;
  data: unknown;
}
interface Snapshot {
  storeEngine: boolean;
  startedAt: string;
  themes: ThemeSnap[];
  working: ThemeSnap;
}

let snap: Snapshot | null = null;

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const url = process.env.PHASE2_TEST_DATABASE_URL;
  if (!url) throw new Error('PHASE2_TEST_DATABASE_URL is not set; run through with-test-db.js');
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    const name = await db.query<{ d: string }>('SELECT current_database() AS d');
    if (name.rows[0]?.d !== 'kh_phase2_test') throw new Error('refusing: not kh_phase2_test');
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function takeSnapshot(): Promise<Snapshot> {
  return withDb(async (db) => {
    const settings = await db.query<{ store_engine: boolean; now: string }>(
      `SELECT store_engine, NOW()::text AS now FROM business_settings WHERE business_id = $1 AND store_subdomain = $2`,
      [BUSINESS_ID, SUBDOMAIN],
    );
    if (!settings.rows[0]) throw new Error('ganesh test store not found');
    const themes = await db.query<ThemeSnap>(
      `SELECT id, name, role, is_working, data FROM store_themes WHERE business_id = $1`,
      [BUSINESS_ID],
    );
    const working = themes.rows.find((t) => t.is_working);
    if (!working) throw new Error('ganesh has no working draft');
    if (!themes.rows.some((t) => t.role === 'live')) throw new Error('ganesh has no live theme');
    return { storeEngine: settings.rows[0].store_engine, startedAt: settings.rows[0].now, themes: themes.rows, working };
  });
}

/** Put the theme rows back exactly as snapshotted and set store_engine. */
async function restore(s: Snapshot, storeEngine: boolean): Promise<void> {
  await withDb(async (db) => {
    await db.query('BEGIN');
    try {
      const ids = s.themes.map((t) => t.id);
      await db.query(`DELETE FROM store_themes WHERE business_id = $1 AND id <> ALL($2::uuid[])`, [BUSINESS_ID, ids]);
      await db.query(`DELETE FROM store_theme_versions WHERE business_id = $1 AND published_at >= $2::timestamptz`, [
        BUSINESS_ID,
        s.startedAt,
      ]);
      // Clear live/working first so the one-per-business indexes never see two at once.
      await db.query(`UPDATE store_themes SET role = 'draft', is_working = false WHERE business_id = $1`, [BUSINESS_ID]);
      for (const t of s.themes) {
        await db.query(
          `UPDATE store_themes SET name = $3, role = $4, is_working = $5, data = $6::jsonb, updated_at = NOW()
           WHERE business_id = $1 AND id = $2`,
          [BUSINESS_ID, t.id, t.name, t.role, t.is_working, JSON.stringify(t.data)],
        );
      }
      await db.query(`UPDATE business_settings SET store_engine = $2 WHERE business_id = $1`, [BUSINESS_ID, storeEngine]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  });
}

async function login(browser: Browser, baseURL: string): Promise<void> {
  const phone = process.env.LOCAL_TEST_PHONE;
  const password = process.env.LOCAL_TEST_PASSWORD;
  if (!phone || !password) throw new Error('LOCAL_TEST_PHONE and LOCAL_TEST_PASSWORD must be set in .env');
  // browser.newContext() inherits this file's test.use() options; start from an empty state.
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const phoneBox = page.getByPlaceholder(/enter your phone/i);
  await phoneBox.waitFor({ state: 'visible', timeout: 120_000 });
  // Wait for hydration before typing, or React drops the input.
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('button')].find((el) => /continue/i.test(el.textContent || ''));
      return !!b && Object.keys(b).some((k) => k.startsWith('__react'));
    },
    undefined,
    { timeout: 120_000 },
  );
  await phoneBox.fill(phone);
  await page.getByRole('button', { name: /continue/i }).click();
  const passwordBox = page.getByPlaceholder(/enter your password/i);
  await passwordBox.waitFor({ state: 'visible', timeout: 30_000 });
  await passwordBox.fill(password);
  await page.getByRole('button', { name: /login/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: SLOW });
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });
  await context.close();
}

// ---- page helpers -------------------------------------------------------------------------------

const editorUrl = (id: string) => `/settings/online-store/themes/${id}/editor`;
const preview = (page: Page): FrameLocator => page.frameLocator('iframe[title="Store preview"]');
const homeRegion = (page: Page) => page.getByRole('navigation', { name: 'Sections' }).getByRole('region', { name: 'Home' });
const treeButton = (page: Page, label: string) => homeRegion(page).getByRole('button', { name: label, exact: true });
const homeLabels = (page: Page) =>
  homeRegion(page).locator(':scope > ul > li > div > button[title]').evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''));

/** The editor is up and the preview has rendered its sections. */
async function waitForEditor(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible({ timeout: SLOW });
  await expect(preview(page).locator('[data-section-group="template"]').first()).toBeVisible({ timeout: SLOW });
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(editorUrl(id), { waitUntil: 'domcontentloaded', timeout: SLOW });
  await waitForEditor(page);
}

async function savedTheme(page: Page, id: string): Promise<{ data: ThemeDataShape; role: string }> {
  const res = await page.request.get(`/api/settings/online-store/themes/${id}?business_id=${BUSINESS_ID}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).theme;
}
type ThemeDataShape = {
  templates: { home: { order: string[]; sections: Record<string, { type: string; settings: Record<string, unknown> }> } };
};
const savedHeading = async (page: Page, id: string, sectionId: string) =>
  (await savedTheme(page, id)).data.templates.home.sections[sectionId]?.settings.heading;

const status = (page: Page) => page.locator('header [aria-live="polite"]');

async function editFeaturedHeading(page: Page, text: string): Promise<void> {
  await treeButton(page, 'Featured products').click();
  const heading = page.getByLabel('Heading', { exact: true });
  await expect(heading).toBeVisible();
  await heading.fill(text);
}

// ---- tests --------------------------------------------------------------------------------------

test.describe('Studio 2 store design editor', () => {
  test.skip(process.env.STUDIO2_E2E !== '1', 'Set STUDIO2_E2E=1 (local test DB only)');
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 240_000 });
  test.use({ storageState: AUTH_FILE, viewport: { width: 1440, height: 900 } });

  test.beforeAll(async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    snap = await takeSnapshot();
    await restore(snap, true);
    await login(browser, baseURL ?? 'http://localhost:3015');
  });

  test.beforeEach(async () => {
    // Every test starts from the snapshotted themes (engine on), whatever the last one did.
    await restore(snap!, true);
  });

  test.afterAll(async () => {
    if (snap) await restore(snap, snap.storeEngine);
  });

  test('edit heading autosaves and survives reload', async ({ page }) => {
    const id = snap!.working.id;
    // Enter through the online store settings button.
    await page.goto('/settings/online-store', { waitUntil: 'domcontentloaded', timeout: SLOW });
    await page.getByRole('button', { name: 'Edit store design (beta)' }).click({ timeout: SLOW });
    await page.waitForURL((u) => u.pathname === editorUrl(id), { timeout: SLOW });
    await waitForEditor(page);

    const text = `E2E heading ${Date.now()}`;
    await editFeaturedHeading(page, text);
    await expect.poll(() => savedHeading(page, id, 'featured-products'), { timeout: 30_000 }).toBe(text);
    await expect(status(page)).toHaveText('Saved');
    await expect(preview(page).getByText(text)).toBeVisible({ timeout: 30_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await treeButton(page, 'Featured products').click();
    await expect(page.getByLabel('Heading', { exact: true })).toHaveValue(text);
    await expect(preview(page).getByText(text)).toBeVisible({ timeout: 30_000 });
  });

  test('drag reorders sections', async ({ page }) => {
    const id = snap!.working.id;
    await openEditor(page, id);
    const before = await homeLabels(page);
    expect(before[0]).toBe('Slideshow');
    const last = before[before.length - 1];

    const rows = homeRegion(page).locator(':scope > ul > li');
    const handle = rows.last().getByRole('button', { name: 'Drag to reorder' });
    const target = rows.first();
    const from = (await handle.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Past the 4 px activation distance, then onto the first row in steps so dnd-kit tracks it.
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 3 });
    await page.mouse.move(from.x + from.width / 2, to.y + 2, { steps: 15 });
    await page.mouse.up();

    const after = [last, ...before.slice(0, -1)];
    await expect.poll(() => homeLabels(page)).toEqual(after);
    await expect.poll(async () => (await savedTheme(page, id)).data.templates.home.order[0], { timeout: 30_000 }).toBe('testimonials');
    // The preview follows the saved order.
    await expect
      .poll(() =>
        preview(page)
          .locator('[data-section-group="template"]')
          .first()
          .getAttribute('data-section-id'),
        { timeout: 30_000 },
      )
      .toBe('testimonials');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    expect(await homeLabels(page)).toEqual(after);
  });

  test('undo after save persists after reload', async ({ page }) => {
    const id = snap!.working.id;
    await openEditor(page, id);
    const text = `E2E undo ${Date.now()}`;
    await editFeaturedHeading(page, text);
    await expect.poll(() => savedHeading(page, id, 'featured-products'), { timeout: 30_000 }).toBe(text);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByLabel('Heading', { exact: true })).toHaveValue('All products');
    await expect.poll(() => savedHeading(page, id, 'featured-products'), { timeout: 30_000 }).toBe('All products');
    await expect(status(page)).toHaveText('Saved');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await treeButton(page, 'Featured products').click();
    await expect(page.getByLabel('Heading', { exact: true })).toHaveValue('All products');
  });

  test('clicking a section in the preview selects it in the tree', async ({ page }) => {
    await openEditor(page, snap!.working.id);
    await expect(treeButton(page, 'Testimonials')).not.toHaveAttribute('aria-current', 'true');
    await preview(page).locator('[data-section-group="template"][data-section-id="testimonials"]').click();
    await expect(treeButton(page, 'Testimonials')).toHaveAttribute('aria-current', 'true');
  });

  test('add section between sections from the preview', async ({ page }) => {
    const id = snap!.working.id;
    await openEditor(page, id);
    const before = await homeLabels(page);

    // The second "+" sits between the first and second home sections (insert at index 1).
    const add = preview(page).getByRole('button', { name: 'Add section here' });
    await expect(add.first()).toBeVisible({ timeout: 30_000 });
    await add.nth(1).click();
    const dialog = page.getByRole('dialog', { name: 'Add section' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^Rich text/ }).first().click();
    await expect(dialog).toBeHidden();

    const after = [before[0], 'Rich text', ...before.slice(1)];
    await expect.poll(() => homeLabels(page)).toEqual(after);
    await expect
      .poll(async () => {
        const home = (await savedTheme(page, id)).data.templates.home;
        return home.sections[home.order[1]]?.type;
      }, { timeout: 30_000 })
      .toBe('rich-text');
    await expect(preview(page).locator('[data-section-group="template"]').nth(1)).toHaveAttribute(
      'data-section-type',
      'rich-text',
      { timeout: 30_000 },
    );
  });

  test('publish then edit again', async ({ page, browser, baseURL }) => {
    const id = snap!.working.id;
    await openEditor(page, id);
    const text = `E2E published ${Date.now()}`;
    await editFeaturedHeading(page, text);
    await expect.poll(() => savedHeading(page, id, 'featured-products'), { timeout: 30_000 }).toBe(text);

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Publish this theme? Shoppers will see it now.' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Publish', exact: true }).click();

    // R11: the draft's data is copied onto the live theme; the editor stays on the same working draft.
    const liveId = snap!.themes.find((t) => t.role === 'live')!.id;
    await expect(page.getByText('Published', { exact: true })).toBeVisible({ timeout: SLOW });
    await expect.poll(() => savedHeading(page, liveId, 'featured-products'), { timeout: 30_000 }).toBe(text);
    expect(new URL(page.url()).pathname).toBe(editorUrl(id));
    const after = await savedTheme(page, id);
    expect(after.role).toBe('draft');
    expect((after as { is_working?: boolean }).is_working).toBe(true);
    await expect(page.getByLabel('Heading', { exact: true })).toHaveValue(text);
    await expect(page.getByLabel('Heading', { exact: true })).toBeEditable();
    const count = await withDb(async (db) =>
      (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM store_themes WHERE business_id = $1`, [BUSINESS_ID])).rows[0].n,
    );
    expect(count).toBe(snap!.themes.length);

    // Shoppers (no preview token, no session) see the published heading.
    const port = new URL(baseURL ?? 'http://localhost:3015').port;
    const shopper = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const shop = await shopper.newPage();
      await shop.goto(`http://${SUBDOMAIN}.localhost${port ? `:${port}` : ''}/`, { waitUntil: 'domcontentloaded', timeout: SLOW });
      await expect(shop.getByText(text)).toBeVisible({ timeout: 30_000 });
    } finally {
      await shopper.close();
    }

    // Editing again saves to the same working draft, never to the live theme.
    const again = `E2E after publish ${Date.now()}`;
    await page.getByLabel('Heading', { exact: true }).fill(again);
    await expect.poll(() => savedHeading(page, id, 'featured-products'), { timeout: 30_000 }).toBe(again);
    expect(await savedHeading(page, liveId, 'featured-products')).toBe(text);
  });

  test('under 1024 px shows the laptop notice', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(editorUrl(snap!.working.id), { waitUntil: 'domcontentloaded', timeout: SLOW });
    await expect(page.getByText('Open the editor on a laptop or desktop')).toBeVisible({ timeout: SLOW });
    await expect(page.locator('iframe[title="Store preview"]')).toHaveCount(0);
  });
});
