/**
 * Studio 2 store design editor, end to end (store engine M2).
 *
 * Local only: runs against a dev server on the disposable `kh_phase2_test` DB and the "Map Test Shop"
 * store (subdomain `ganesh`). Skipped unless STUDIO2_E2E=1. The spec talks to that DB directly to turn
 * `store_engine` on, reset the theme rows before each test and put everything back afterwards
 * (published theme, working draft, versions, `store_engine`), so run it through the test-DB wrapper:
 *
 *   STUDIO2_E2E=1 PLAYWRIGHT_BASE_URL=http://localhost:3015 PLAYWRIGHT_SKIP_WEBSERVER=1 \
 *     node .superpowers/sdd/2026-10-30-store-engine-m3-every-page/with-test-db.js \
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
const MISSING_PRODUCT_ID = '00000000-0000-0000-0000-000000000000';

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

/** Origin of the ganesh test store (shoppers browse it on the subdomain, not the app origin). */
const storeOrigin = (baseURL: string | undefined) => {
  const port = new URL(baseURL ?? 'http://localhost:3015').port;
  return `http://${SUBDOMAIN}.localhost${port ? `:${port}` : ''}`;
};

const sectionsNav = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

/** Switch the editor's page switcher and wait for that page's tree group to show. */
async function switchPage(page: Page, key: 'product' | 'catalog'): Promise<void> {
  await page.getByLabel('Page', { exact: true }).selectOption(key);
  await expect(sectionsNav(page).getByRole('region', { name: key === 'product' ? 'Product' : 'Catalog' })).toBeVisible({ timeout: SLOW });
}

/** An empty Product or Catalog template shows "Use the default layout"; click it when it is there. */
async function useDefaultLayout(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Use the default layout' });
  await btn.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
  if (await btn.isVisible()) await btn.click();
}

/**
 * A cold compile of a route can abort the first client-side navigation to it, so request each route the
 * scenarios use once, directly, before any test runs. Failures here are ignored: the tests report real ones.
 */
async function warmUp(browser: Browser, baseURL: string | undefined): Promise<void> {
  const productId = await withDb(async (db) =>
    (
      await db.query<{ id: string }>(
        `SELECT id FROM items WHERE business_id = $1 AND (show_in_store = true OR featured_in_store = true) ORDER BY name LIMIT 1`,
        [BUSINESS_ID],
      )
    ).rows[0]?.id,
  );
  const origin = storeOrigin(baseURL);
  const admin = await browser.newContext({ baseURL, storageState: AUTH_FILE });
  const shopper = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const a = await admin.newPage();
    const s = await shopper.newPage();
    const visit = async (p: Page, url: string) => {
      try {
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await p.waitForLoadState('load', { timeout: 60_000 }).catch(() => undefined);
      } catch {
        /* warm-up only */
      }
    };
    await visit(a, '/settings/online-store');
    await visit(a, editorUrl(snap!.working.id));
    await visit(s, `${origin}/catalog`);
    if (productId) await visit(s, `${origin}/products/${productId}`);
    await visit(s, `${origin}/pages/e2e-page`);
    await visit(s, `${origin}/products/${MISSING_PRODUCT_ID}`);
  } finally {
    await admin.close();
    await shopper.close();
  }
}

async function editFeaturedHeading(page: Page, text: string): Promise<void> {
  await treeButton(page, 'Featured products').click();
  const heading = page.getByLabel('Heading', { exact: true });
  await expect(heading).toBeVisible();
  await heading.fill(text);
}

type BlockedSection = { block_order: string[]; blocks: Record<string, { type: string; disabled?: boolean }> };

/** The block types of one home section, in saved order. */
async function blockTypes(page: Page, id: string, sectionId: string): Promise<string[]> {
  const section = (await savedTheme(page, id)).data.templates.home.sections[sectionId] as unknown as BlockedSection | undefined;
  return (section?.block_order ?? []).map((b) => section!.blocks[b].type);
}

/** The disabled flag of each block of one home section, in saved order. */
async function blockDisabled(page: Page, id: string, sectionId: string): Promise<boolean[]> {
  const section = (await savedTheme(page, id)).data.templates.home.sections[sectionId] as unknown as BlockedSection | undefined;
  return (section?.block_order ?? []).map((b) => !!section!.blocks[b].disabled);
}

/** Open a section's block list in the tree (a no-op when it is already open). */
async function expandSection(page: Page, label: string): Promise<void> {
  const open = sectionsNav(page).getByRole('button', { name: `Expand ${label}`, exact: true });
  if (await open.isVisible()) await open.click();
  await expect(sectionsNav(page).getByRole('button', { name: `Collapse ${label}`, exact: true })).toBeVisible();
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
    await warmUp(browser, baseURL);
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

    // Each "+" posts `add-at` with the template key and `after` (the id of the section above it, null for
    // the top); the editor resolves that against its own order. The second "+" sits under the first home
    // section, so the new section lands at position 1.
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

  test('product page: default layout, edit the delivery estimate', async ({ page }) => {
    await openEditor(page, snap!.working.id);
    await switchPage(page, 'product');
    await useDefaultLayout(page);
    await expect(preview(page).locator('[data-section-group="template"][data-section-type="main-product"]')).toBeVisible({ timeout: SLOW });

    // The default product layout has no Delivery estimate block (R2), so add one from the section's blocks.
    await page.getByRole('button', { name: 'Expand Product information' }).click();
    const existing = sectionsNav(page).locator('button[title="Delivery estimate"]');
    if ((await existing.count()) === 0) {
      await page.getByRole('button', { name: 'Add block', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Delivery estimate/ }).click();
    } else {
      await existing.first().click();
    }

    const text = `E2E delivery ${Date.now()}`;
    const field = page.getByLabel('Text', { exact: true });
    await expect(field).toBeVisible();
    await field.fill(text);
    await expect(status(page)).toHaveText('Saved', { timeout: 30_000 });
    await expect(preview(page).getByText(text)).toBeVisible({ timeout: 30_000 });
  });

  test('catalog page: default layout, three columns on desktop', async ({ page }) => {
    // Wide enough that the preview pane is past the grid's 1024 px container breakpoint, where the
    // default is 4 columns; 3 then comes only from the setting.
    await page.setViewportSize({ width: 1920, height: 1000 });
    await openEditor(page, snap!.working.id);
    await switchPage(page, 'catalog');
    await useDefaultLayout(page);
    const grid = preview(page).locator('.eng-catalog-grid').first();
    await expect(grid).toBeVisible({ timeout: SLOW });
    const columns = () => grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);

    await sectionsNav(page).getByRole('button', { name: 'Product grid', exact: true }).click();
    const box = page.getByRole('spinbutton', { name: 'Columns on desktop' });
    await expect(box).toBeVisible();
    await box.fill('3');
    await box.press('Enter');
    await expect(status(page)).toHaveText('Saved', { timeout: 30_000 });
    await expect.poll(columns, { timeout: 30_000 }).toBe(3);
  });

  test('create custom page and open it', async ({ page, browser, baseURL }) => {
    await openEditor(page, snap!.working.id);
    await page.getByRole('button', { name: 'New page', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New page' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title', { exact: true }).fill('E2E Page');
    await expect(dialog.getByLabel('Address', { exact: true })).toHaveValue('e2e-page');
    await dialog.getByLabel('Blank page').check();
    await dialog.getByRole('button', { name: 'Create page' }).click();
    await expect(dialog).toBeHidden();

    // The editor opens the new, empty page; add a Rich text section and write its content.
    const region = sectionsNav(page).getByRole('region', { name: 'E2E Page' });
    await expect(region).toBeVisible({ timeout: SLOW });
    await region.getByRole('button', { name: 'Add section', exact: true }).click();
    const add = page.getByRole('dialog', { name: 'Add section' });
    await expect(add).toBeVisible();
    await add.getByRole('button', { name: /^Rich text/ }).first().click();
    await expect(add).toBeHidden();

    const editor = page.locator('[contenteditable="true"][role="textbox"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Hello e2e');
    await expect(status(page)).toHaveText('Saved', { timeout: 30_000 });

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Publish this theme? Shoppers will see it now.' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published', { exact: true })).toBeVisible({ timeout: SLOW });

    const shopper = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const shop = await shopper.newPage();
      await shop.goto(`${storeOrigin(baseURL)}/pages/e2e-page`, { waitUntil: 'domcontentloaded', timeout: SLOW });
      await expect(shop.getByText('Hello e2e')).toBeVisible({ timeout: 30_000 });
    } finally {
      await shopper.close();
    }
  });

  test('unknown product id shows "Product not found." with the header', async ({ browser, baseURL }) => {
    // Make sure the live Product template is an engine layout (an empty one renders the classic page).
    await withDb((db) =>
      db.query(
        `UPDATE store_themes SET data = jsonb_set(data, '{templates,product}', $2::jsonb)
         WHERE business_id = $1 AND role = 'live'`,
        [
          BUSINESS_ID,
          JSON.stringify({
            order: ['main-product-1'],
            sections: { 'main-product-1': { type: 'main-product', settings: {}, blocks: {}, block_order: [] } },
          }),
        ],
      ),
    );
    const shopper = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const shop = await shopper.newPage();
      await shop.goto(`${storeOrigin(baseURL)}/products/${MISSING_PRODUCT_ID}`, { waitUntil: 'domcontentloaded', timeout: SLOW });
      await expect(shop.getByText('Product not found.')).toBeVisible({ timeout: SLOW });
      await expect(shop.locator('[data-section-group="header"]').first()).toBeVisible();
    } finally {
      await shopper.close();
    }
  });

  // ---- premium theme foundations (written, not run: they need the local test DB like the rest) --------

  test('content blocks: add, reorder, disable, save, reload', async ({ page }) => {
    const id = snap!.working.id;
    await openEditor(page, id);

    // Add an Image with text under the first home section. Its starter preset brings its own blocks; the test
    // reads them back rather than assuming which, and builds its expectation on top.
    const add = preview(page).getByRole('button', { name: 'Add section here' });
    await expect(add.first()).toBeVisible({ timeout: 30_000 });
    await add.nth(1).click();
    const dialog = page.getByRole('dialog', { name: 'Add section' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^Image with text/ }).first().click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => {
        const home = (await savedTheme(page, id)).data.templates.home;
        return home.sections[home.order[1]]?.type;
      }, { timeout: 30_000 })
      .toBe('image-with-text');
    const sectionId = (await savedTheme(page, id)).data.templates.home.order[1];
    const initial = await blockTypes(page, id, sectionId);

    // Open the section's block list, then add an eyebrow, a quote, a checklist item and two buttons.
    await expandSection(page, 'Image with text');
    for (const name of ['Eyebrow', 'Quote', 'Checklist item', 'Button', 'Button']) {
      await page.getByRole('button', { name: 'Add block', exact: true }).click();
      await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
      await expect(status(page)).toHaveText('Saved', { timeout: 30_000 });
    }
    const added = [...initial, 'eyebrow', 'quote', 'checklist_item', 'button', 'button'];
    await expect.poll(() => blockTypes(page, id, sectionId), { timeout: 30_000 }).toEqual(added);

    // Drag the quote onto the first text block's row: the quote takes the text's place, the text moves down.
    const row = (label: string) => sectionsNav(page).locator(`li:has(> button[title="${label}"])`);
    const text = row('Text').first();
    const quote = row('Quote').first();
    await expect(text).toBeVisible();
    const handle = quote.getByRole('button', { name: 'Drag to reorder' });
    const from = (await handle.boundingBox())!;
    const to = (await text.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 3 });
    await page.mouse.move(from.x + from.width / 2, to.y + 2, { steps: 15 });
    await page.mouse.up();

    const reordered = added.filter((_, i) => i !== added.indexOf('quote'));
    reordered.splice(added.indexOf('text'), 0, 'quote');
    await expect.poll(() => blockTypes(page, id, sectionId), { timeout: 30_000 }).toEqual(reordered);

    // Disable the second button (the last block): its eye turns into "Show Button".
    await sectionsNav(page).getByRole('button', { name: 'Hide Button' }).last().click();
    await expect(sectionsNav(page).getByRole('button', { name: 'Show Button' })).toHaveCount(1);
    await expect(status(page)).toHaveText('Saved', { timeout: 30_000 });
    const onlyLastOff = reordered.map((_, i) => i === reordered.length - 1);
    await expect.poll(() => blockDisabled(page, id, sectionId), { timeout: 30_000 }).toEqual(onlyLastOff);
    // The preview follows: the section is there.
    await expect(preview(page).locator(`[data-section-group="template"][data-section-id="${sectionId}"]`)).toBeVisible({ timeout: 30_000 });

    // Reload: same order, same disabled flag, and the tree lists the quote above the text.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEditor(page);
    await expandSection(page, 'Image with text');
    await expect(sectionsNav(page).getByRole('button', { name: 'Show Button' })).toHaveCount(1);
    await expect.poll(() => blockTypes(page, id, sectionId)).toEqual(reordered);
    await expect.poll(() => blockDisabled(page, id, sectionId)).toEqual(onlyLastOff);
    const labels = await sectionsNav(page)
      .locator('li:has(> button[title="Quote"])')
      .first()
      .locator('xpath=ancestor::ul[1]/li/button[@title]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('title')));
    expect(labels.indexOf('Quote')).toBeLessThan(labels.indexOf('Text'));
  });

  test('style settings: spaced capitals, thin accent border and dots reach the preview root', async ({ page }) => {
    const id = snap!.working.id;
    await openEditor(page, id);
    await sectionsNav(page).getByRole('button', { name: 'Theme settings' }).click();

    await page.getByLabel('Label style', { exact: true }).selectOption('caps');
    await page.getByLabel('Frame style', { exact: true }).selectOption('accent');
    await page.getByLabel('Background texture', { exact: true }).selectOption('dots');
    await expect(status(page)).toHaveText('Saved', { timeout: 30_000 });

    const root = preview(page).locator('.eng-root').first();
    await expect(root).toHaveClass(/eng-labels-caps eng-frame-accent eng-texture-dots/, { timeout: 30_000 });
    await expect
      .poll(async () => {
        const data = (await savedTheme(page, id)).data as unknown as { settings: Record<string, unknown> };
        return [data.settings.label_style, data.settings.frame_style, data.settings.texture];
      }, { timeout: 30_000 })
      .toEqual(['caps', 'accent', 'dots']);

    // Back to the defaults: the three classes go away.
    await page.getByLabel('Label style', { exact: true }).selectOption('normal');
    await page.getByLabel('Frame style', { exact: true }).selectOption('none');
    await page.getByLabel('Background texture', { exact: true }).selectOption('none');
    await expect(root).not.toHaveClass(/eng-labels-caps|eng-frame-accent|eng-texture-/, { timeout: 30_000 });
  });

  test('card switches: Show tagline and Show colour swatches draw .ptag and .pswatches', async ({ page }) => {
    const id = snap!.working.id;
    const tagline = `E2E tagline ${Date.now()}`;
    // Give the store's visible items a tagline and two swatches; every value is put back afterwards.
    const visible = `business_id = $1 AND (show_in_store = true OR featured_in_store = true)`;
    const before = await withDb(async (db) => {
      const rows = (
        await db.query<{ id: string; store_badge: string | null; store_tagline: string | null; store_swatches: unknown }>(
          `SELECT id, store_badge, store_tagline, store_swatches FROM items WHERE ${visible}`,
          [BUSINESS_ID],
        )
      ).rows;
      await db.query(`UPDATE items SET store_tagline = $2, store_swatches = $3::jsonb WHERE ${visible}`, [
        BUSINESS_ID,
        tagline,
        JSON.stringify([{ hex: '#b94717', name: 'Rust' }, { hex: '#1f3a5f', name: 'Navy' }]),
      ]);
      return rows;
    });
    expect(before.length).toBeGreaterThan(0);
    try {
      await openEditor(page, id);
      await treeButton(page, 'Featured products').click();
      const grid = preview(page).locator('[data-section-id="featured-products"]');
      // Off by default: the cards carry neither line.
      await expect(grid.locator('.pname').first()).toBeVisible({ timeout: SLOW });
      await expect(grid.locator('.ptag')).toHaveCount(0);
      await expect(grid.locator('.pswatches')).toHaveCount(0);

      await page.getByLabel('Show tagline', { exact: true }).check();
      await page.getByLabel('Show colour swatches', { exact: true }).check();
      await expect(status(page)).toHaveText('Saved', { timeout: 30_000 });

      await expect(grid.locator('.ptag').first()).toHaveText(tagline, { timeout: 30_000 });
      await expect(grid.locator('.pswatches').first()).toBeVisible();
      await expect(grid.locator('.pswatches').first().locator('span')).toHaveCount(2);

      // Both switches survive a reload.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForEditor(page);
      await treeButton(page, 'Featured products').click();
      await expect(page.getByLabel('Show tagline', { exact: true })).toBeChecked();
      await expect(page.getByLabel('Show colour swatches', { exact: true })).toBeChecked();
      await expect(grid.locator('.ptag').first()).toHaveText(tagline, { timeout: 30_000 });
    } finally {
      await withDb(async (db) => {
        for (const r of before) {
          await db.query(`UPDATE items SET store_badge = $2, store_tagline = $3, store_swatches = $4::jsonb WHERE id = $1`, [
            r.id,
            r.store_badge,
            r.store_tagline,
            JSON.stringify(r.store_swatches ?? []),
          ]);
        }
      });
    }
  });
});
