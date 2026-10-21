/**
 * Items screen against a server that must be started on kh_phase2_test.
 * Refuses to run if the disposable database check fails.
 * Does not use a saved staging session.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { test, expect } from '@playwright/test';

function readEnvFile(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

const env = readEnvFile(path.resolve(process.cwd(), '.env'));
const host = env.DB_HOST || '';
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  throw new Error('Refusing items screen test: database host is not local');
}

const databaseUrl = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${env.DB_PORT || '5432'}/kh_phase2_test`;

const B = randomUUID();
const BR = randomUUID();
const OWNER = randomUUID();
const DENIED = randomUUID();
const ROLE = randomUUID();
const ACTIVE = randomUUID();
const HIDDEN = randomUUID();
const TARGET = randomUUID();
const tag = B.slice(0, 8);
const password = `Qa${tag}!items`;
const ownerPhone = `91${Date.now().toString().slice(-8)}1`;
const deniedPhone = `91${Date.now().toString().slice(-8)}2`;
const activeName = `Screen active ${tag}`;
const hiddenName = `Screen hidden ${tag}`;
const targetName = `Screen delete ${tag}`;

let pool: Pool;

async function login(page: import('@playwright/test').Page, phone: string) {
  const res = await page.request.post('/api/auth/login', {
    data: { phone, password },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function dismissWelcome(page: import('@playwright/test').Page) {
  const skip = page.getByRole('button', { name: /explore on my own/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
  }
}

test.describe('items screen soft delete', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180000);

  test.beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`,
    );
    const info = db.rows[0];
    if (
      info.db !== 'kh_phase2_test' ||
      info.port !== 5433 ||
      (!info.addr.includes('127.0.0.1') && !info.addr.includes('::1'))
    ) {
      throw new Error(`Refusing items screen test against ${info.db} at ${info.addr}:${info.port}`);
    }
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE feature_id = 'reports_basic' AND enabled = true
        ORDER BY plan_id LIMIT 1`,
    );
    const planId = plan.rows[0]?.plan_id;
    if (!planId) throw new Error('No enabled reports_basic plan');
    const hash = bcrypt.hashSync(password, 8);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [B, `Screen ${tag}`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, is_default, is_active) VALUES ($1, $2, 'Main', true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [B],
    );
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [B, planId],
    );
    await pool.query(
      `INSERT INTO user_roles (id, business_id, role_name, role_key, is_system_role)
       VALUES ($1, $2, 'Read only', 'qa_screen_read', false)`,
      [ROLE, B],
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
       VALUES ($1, 'items', true, false, false, false, false)`,
      [ROLE],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, password_hash, is_primary_admin, role_id, auth_session_version, is_active)
       VALUES ($1, $3, 'Owner', $4, $5, true, NULL, 1, true),
              ($2, $3, 'No delete', $6, $5, false, $7, 1, true)`,
      [OWNER, DENIED, B, ownerPhone, hash, deniedPhone, ROLE],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, is_active)
       VALUES ($1, $4, $5, 'goods', 'PCS', 10, true),
              ($2, $4, $6, 'goods', 'PCS', 10, true),
              ($3, $4, $7, 'goods', 'PCS', 10, true)`,
      [ACTIVE, HIDDEN, TARGET, B, activeName, hiddenName, targetName],
    );
    await pool.query(`UPDATE items SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [HIDDEN]);
  });

  test.afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM user_activity_logs WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM items WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM users WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM role_permissions WHERE role_id = $1`, [ROLE]);
      await pool.query(`DELETE FROM user_roles WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM business_modules WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM branches WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM businesses WHERE id = $1`, [B]);
    } finally {
      await pool.end();
    }
  });

  test('owner sees the active item, not the soft-deleted item, and confirms deletion', async ({ page }) => {
    await login(page, ownerPhone);
    const listed = page.waitForResponse(
      (response) => response.url().includes('/api/items') && response.request().method() === 'GET',
      { timeout: 60000 },
    );
    await page.goto('/items');
    const listResponse = await listed;
    expect(listResponse.status(), await listResponse.text()).toBe(200);
    const table = page.getByRole('table');
    await expect(table.getByText(activeName)).toBeVisible({ timeout: 20000 });
    await dismissWelcome(page);
    await expect(page.getByText(hiddenName)).toHaveCount(0);
    const row = table.getByRole('row').filter({ hasText: targetName });
    await row.getByTitle('Delete').click();
    const dialog = page.getByRole('dialog').filter({ hasText: targetName });
    await expect(dialog).toBeVisible();
    const removed = page.waitForResponse(
      (response) => response.url().includes('/api/items/') && response.request().method() === 'DELETE',
    );
    const followUp = page.waitForResponse(
      (response) => response.url().includes('/api/items?') && response.request().method() === 'GET',
    );
    await dialog.getByRole('button', { name: 'Delete' }).click();
    expect((await removed).status()).toBe(200);
    const followBody = await (await followUp).text();
    expect(followBody.includes(targetName)).toBe(false);
    await expect(table.getByText(targetName)).toHaveCount(0, { timeout: 15000 });
    const stored = await pool.query<{ deleted_at: string | null; name: string }>(
      `SELECT name, deleted_at::text FROM items WHERE id = $1`,
      [TARGET],
    );
    expect(stored.rows[0].name).toBe(targetName);
    expect(stored.rows[0].deleted_at).toBeTruthy();
  });

  test('a user without delete permission sees the item and cannot delete it', async ({ page }) => {
    const before = await pool.query<{ deleted_at: string | null }>(
      `SELECT deleted_at::text FROM items WHERE id = $1`,
      [ACTIVE],
    );
    await login(page, deniedPhone);
    await page.goto('/items');
    const table = page.getByRole('table');
    await expect(table.getByText(activeName)).toBeVisible({ timeout: 20000 });
    await dismissWelcome(page);
    const row = table.getByRole('row').filter({ hasText: activeName });
    await expect(row.getByTitle("You don't have permission to delete items")).toBeDisabled();
    expect((await pool.query<{ deleted_at: string | null }>(`SELECT deleted_at::text FROM items WHERE id = $1`, [ACTIVE])).rows[0].deleted_at).toBe(
      before.rows[0].deleted_at,
    );
  });
});
