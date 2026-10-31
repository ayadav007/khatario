/**
 * Theme library, end to end (store engine M5, Task 5).
 *
 * Local only, same setup as e2e/store-studio2.spec.ts: a dev server on the disposable `kh_phase2_test` DB and the
 * "Map Test Shop" store (subdomain `ganesh`). Skipped unless STUDIO2_E2E=1. The spec talks to that DB directly to
 * turn `store_engine` on, put the theme rows back before each test and restore everything afterwards (themes with
 * their names, presets, roles and data, versions written during the run, `store_engine`), so run it through the
 * test-DB wrapper:
 *
 *   STUDIO2_E2E=1 PLAYWRIGHT_BASE_URL=http://localhost:3015 PLAYWRIGHT_SKIP_WEBSERVER=1 \
 *     node .superpowers/sdd/2026-10-31-store-engine-m5-library-history/with-test-db.js \
 *     npx playwright test e2e/store-theme-library.spec.ts --project=chromium
 *
 * Login uses LOCAL_TEST_PHONE / LOCAL_TEST_PASSWORD from .env (the local Map Tester account) and keeps its own
 * storage state under e2e/.auth/ (git-ignored). The DB snapshot, restore and login are the Studio 2 spec's, copied
 * (a spec file cannot be imported without registering its tests) and extended with `preset`.
 */
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { deleteConfirmText, publishConfirmText } from '../lib/store/engine/library';

config({ path: '.env' });

const BUSINESS_ID = '4b49ddef-59bc-4ec3-94c0-65f615ce32a3';
const SUBDOMAIN = 'ganesh';
const AUTH_FILE = path.join(__dirname, '.auth', 'theme-library-local.json');
const SLOW = 90_000;
const LIBRARY = '/settings/online-store/themes';

interface ThemeSnap {
  id: string;
  name: string;
  role: string;
  preset: string;
  is_working: boolean;
  data: unknown;
}
interface Snapshot {
  storeEngine: boolean;
  startedAt: string;
  themes: ThemeSnap[];
  live: ThemeSnap;
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
      `SELECT id, name, role, preset, is_working, data FROM store_themes WHERE business_id = $1`,
      [BUSINESS_ID],
    );
    const working = themes.rows.find((t) => t.is_working);
    const live = themes.rows.find((t) => t.role === 'live');
    if (!working) throw new Error('ganesh has no working draft');
    if (!live) throw new Error('ganesh has no live theme');
    // Room for the drafts the scenarios add (at most three at once).
    if (themes.rows.length > 17) throw new Error('ganesh has too many themes for this spec');
    return { storeEngine: settings.rows[0].store_engine, startedAt: settings.rows[0].now, themes: themes.rows, live, working };
  });
}

/** Put the theme rows back exactly as snapshotted (presets included) and set store_engine. */
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
          `UPDATE store_themes SET name = $3, role = $4, is_working = $5, preset = $6, data = $7::jsonb, updated_at = NOW()
           WHERE business_id = $1 AND id = $2`,
          [BUSINESS_ID, t.id, t.name, t.role, t.is_working, t.preset, JSON.stringify(t.data)],
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

const liveRow = (page: Page): Locator => page.locator('[data-theme-kind="live"]');
const workingRow = (page: Page): Locator => page.locator('[data-theme-kind="working"]');
const draftRows = (page: Page): Locator => page.locator('[data-theme-kind="draft"]');
const draftNamed = (page: Page, name: string): Locator =>
  draftRows(page).filter({ has: page.getByRole('heading', { name, exact: true }) });

async function openLibrary(page: Page): Promise<void> {
  await page.goto(LIBRARY, { waitUntil: 'domcontentloaded', timeout: SLOW });
  await expect(liveRow(page)).toBeVisible({ timeout: SLOW });
}

async function themeCount(): Promise<number> {
  return withDb(async (db) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM store_themes WHERE business_id = $1`, [BUSINESS_ID])).rows[0].n,
  );
}

/** Add a theme from the modal: a preset label ("Premium Grocery") or "Your current store design". */
async function addTheme(page: Page, choice: string, name?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add theme', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add theme' });
  await expect(dialog).toBeVisible();
  await dialog.getByText(choice, { exact: true }).click();
  if (name !== undefined) await dialog.getByLabel(/^Name/).fill(name);
  await dialog.getByRole('button', { name: 'Add theme', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: SLOW });
}

async function savedTheme(page: Page, id: string): Promise<{ id: string; role: string; preset: string; is_working: boolean; data: unknown }> {
  const res = await page.request.get(`/api/settings/online-store/themes/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).theme;
}

// ---- tests --------------------------------------------------------------------------------------

test.describe('Store theme library', () => {
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

  test('library shows live card and working copy', async ({ page }) => {
    await page.goto('/settings/online-store', { waitUntil: 'domcontentloaded', timeout: SLOW });
    await page.getByRole('link', { name: 'Themes (beta)' }).click();
    await page.waitForURL((u) => u.pathname === LIBRARY, { timeout: SLOW });

    await expect(page.getByRole('heading', { name: 'Themes', exact: true })).toBeVisible({ timeout: SLOW });
    await expect(page.getByText(`${snap!.themes.length} of 20 themes`, { exact: true })).toBeVisible({ timeout: SLOW });
    await expect(liveRow(page).getByRole('heading', { name: snap!.live.name, exact: true })).toBeVisible();
    await expect(workingRow(page)).toBeVisible();
    await expect(workingRow(page).getByText('Working copy', { exact: true })).toBeVisible();
    // The working draft is shown only inside the live card, never among the drafts.
    await expect(page.locator(`[data-theme-kind="draft"][data-theme-id="${snap!.working.id}"]`)).toHaveCount(0);
    // The engine is on: no classic-store notice.
    await expect(page.getByText(/Shoppers still see your classic store/)).toHaveCount(0);
  });

  test('add Grocery theme, rename, duplicate, delete the copy', async ({ page }) => {
    await openLibrary(page);
    await addTheme(page, 'Premium Grocery', 'Green test');
    const first = draftRows(page).first();
    await expect(first.getByRole('heading', { name: 'Green test', exact: true })).toBeVisible({ timeout: SLOW });
    await expect(first.getByText(/^Premium Grocery · Edited/)).toBeVisible();
    expect(await themeCount()).toBe(snap!.themes.length + 1);

    // Rename.
    await draftNamed(page, 'Green test').getByRole('button', { name: 'Rename', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename theme' });
    await rename.getByLabel('Name', { exact: true }).fill('Green 2');
    await rename.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(rename).toBeHidden({ timeout: SLOW });
    await expect(draftNamed(page, 'Green 2')).toBeVisible({ timeout: SLOW });

    // Duplicate: the copy lands at the top of the drafts.
    await draftNamed(page, 'Green 2').getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(draftRows(page).first().getByRole('heading', { name: 'Copy of Green 2', exact: true })).toBeVisible({
      timeout: SLOW,
    });
    expect(await themeCount()).toBe(snap!.themes.length + 2);

    // Delete the copy: the confirm names it.
    await draftNamed(page, 'Copy of Green 2').getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: deleteConfirmText('Copy of Green 2') });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirm).toBeHidden({ timeout: SLOW });
    await expect(draftNamed(page, 'Copy of Green 2')).toHaveCount(0);
    await expect(draftNamed(page, 'Green 2')).toBeVisible();
    expect(await themeCount()).toBe(snap!.themes.length + 1);
  });

  test('publish a draft then customise keeps the published design', async ({ page }) => {
    await openLibrary(page);
    await addTheme(page, 'Premium Grocery', 'N2 test');
    const row = draftNamed(page, 'N2 test');
    await expect(row).toBeVisible({ timeout: SLOW });
    const xId = await row.getAttribute('data-theme-id');
    expect(xId).toBeTruthy();

    await row.getByRole('button', { name: 'Publish', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: publishConfirmText('N2 test', true) });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(confirm).toBeHidden({ timeout: SLOW });

    // X is live; the old live theme is now a draft.
    await expect(liveRow(page).getByRole('heading', { name: 'N2 test', exact: true })).toBeVisible({ timeout: SLOW });
    await expect(page.locator(`[data-theme-kind="draft"][data-theme-id="${snap!.live.id}"]`)).toBeVisible();

    // Customise opens the working draft, which now carries X's design (N2), never the old one.
    await liveRow(page).getByRole('button', { name: 'Customise', exact: true }).click();
    await page.waitForURL((u) => /\/settings\/online-store\/themes\/[^/]+\/editor$/.test(u.pathname), { timeout: SLOW });
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible({ timeout: SLOW });
    const wId = decodeURIComponent(new URL(page.url()).pathname.split('/')[4] ?? '');
    const [w, x] = await Promise.all([savedTheme(page, wId), savedTheme(page, xId!)]);
    expect(x.role).toBe('live');
    expect(w.is_working).toBe(true);
    expect(w.preset).toBe('grocery');
    expect(JSON.stringify(w.data)).toBe(JSON.stringify(x.data));
  });

  test('working copy has no Delete', async ({ page }) => {
    await openLibrary(page);
    await expect(workingRow(page)).toBeVisible();
    await expect(workingRow(page).getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await expect(liveRow(page).getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);

    // Phone width: the actions are in the "⋯" menu, still without Delete; Customise says to use a laptop.
    await page.setViewportSize({ width: 390, height: 844 });
    await workingRow(page).getByRole('button', { name: /^Actions for / }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Preview link' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
    await expect(workingRow(page).getByText('Open the editor on a laptop or desktop')).toBeVisible();
  });

  test('add from current store design', async ({ page }) => {
    await openLibrary(page);
    await addTheme(page, 'Your current store design');
    const first = draftRows(page).first();
    await expect(first.getByRole('heading', { name: / \(from your store\)$/ })).toBeVisible({ timeout: SLOW });
    expect(await themeCount()).toBe(snap!.themes.length + 1);
    const id = await first.getAttribute('data-theme-id');
    const theme = await savedTheme(page, id!);
    expect(theme.role).toBe('draft');
    expect(theme.is_working).toBe(false);
  });
});
