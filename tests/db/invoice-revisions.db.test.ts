/**
 * Invoice revision history (migration 469): commit-time triggers snapshot every change to an
 * invoice, its lines or its charges into append-only invoice_revisions.
 * Writes only after current_database() is kh_phase2_test on localhost.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

function readEnvFile(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[match[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing invoice revision tests: database host is not local');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';

const MIGRATION = fs.readFileSync(
  path.resolve(process.cwd(), 'database/migrations/469_invoice_revisions.sql'),
  'utf8',
);
const DAY = '2026-10-20';

describe('invoice revisions (kh_phase2_test)', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const USER = randomUUID();
  const CUST = randomUUID();
  const INV = randomUUID();
  const tag = B.slice(0, 8);
  const headers = {
    'content-type': 'application/json',
    'x-authenticated-user-id': USER,
    'x-authenticated-business-id': B,
    'x-authenticated-session-version': '1',
  };

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function revisions(invoiceId: string) {
    const res = await pool.query(
      `SELECT revision_no, action, reason, actor_user_id, actor_name, snapshot
         FROM invoice_revisions WHERE invoice_id = $1 ORDER BY revision_no`,
      [invoiceId],
    );
    return res.rows;
  }

  async function insertItem(c: PoolClient | Pool, invoiceId: string, sort: number, name: string, qty: number) {
    await c.query(
      `INSERT INTO invoice_items (invoice_id, item_name, quantity, unit_price, line_total, sort_order)
       VALUES ($1, $2, $3, 100, $4, $5)`,
      [invoiceId, name, qty, qty * 100, sort],
    );
  }

  async function insertFinalInvoice(id: string, number: string) {
    await tx(async (c) => {
      await c.query(
        `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type,
                               place_of_supply_state_code, notes, is_editable)
         VALUES ($1, $2, $3, $4, $5, $6::date, 'final', 'tax_invoice', '29', 'Old', false)`,
        [id, B, BR, CUST, number, DAY],
      );
      await insertItem(c, id, 0, 'Rice', 2);
    });
  }

  beforeAll(async () => {
    pool = getPool();
    const info = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (info.rows[0]?.db !== 'kh_phase2_test') throw new Error(`Refusing to mutate database ${info.rows[0]?.db}`);

    await pool.query(MIGRATION);
    await pool.query(MIGRATION);

    await pool.query(
      `INSERT INTO businesses (id, name, state, state_code, gst_registration_type) VALUES ($1, $2, 'Karnataka', '29', 'regular')`,
      [B, `Revisions ${tag}`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '29', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
      [USER, B, `6${Date.now().toString().slice(-9)}`],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state, state_code) VALUES ($1, $2, 'Shalini', 'Karnataka', '29')`,
      [CUST, B],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM businesses WHERE id = $1`, [B]);
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await closePool();
    }
  });

  it('gives every invoice that existed before the migration a baseline revision', async () => {
    const missing = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM invoices i
        WHERE NOT EXISTS (SELECT 1 FROM invoice_revisions r WHERE r.invoice_id = i.id)`,
    );
    expect(missing.rows[0].n).toBe('0');
  });

  it('records revision 1 as created, with its lines, when an invoice is inserted', async () => {
    await tx(async (c) => {
      await c.query(
        `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type,
                               place_of_supply_state_code, notes, purchase_order_number)
         VALUES ($1, $2, $3, $4, $5, $6::date, 'draft', 'tax_invoice', '29', 'Old', 'PO-1')`,
        [INV, B, BR, CUST, `REV-${tag}`, DAY],
      );
      await insertItem(c, INV, 0, 'Rice', 2);
      await insertItem(c, INV, 1, 'Dal', 1);
    });
    const rows = await revisions(INV);
    expect(rows).toHaveLength(1);
    expect(rows[0].revision_no).toBe(1);
    expect(rows[0].action).toBe('created');
    expect(rows[0].snapshot.lines).toHaveLength(2);
    expect(rows[0].snapshot.lines[0].item_name).toBe('Rice');
    expect(rows[0].snapshot.header.notes).toBe('Old');
  });

  it('makes one revision for a transaction that writes the invoice many times', async () => {
    await tx(async (c) => {
      await c.query(`UPDATE invoices SET notes = 'New' WHERE id = $1`, [INV]);
      await c.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [INV]);
      await insertItem(c, INV, 0, 'Rice', 3);
      await insertItem(c, INV, 1, 'Dal', 1);
      await c.query(`UPDATE invoices SET grand_total = 400 WHERE id = $1`, [INV]);
    });
    const rows = await revisions(INV);
    expect(rows).toHaveLength(2);
    expect(rows[1].snapshot.header.notes).toBe('New');
    expect(Number(rows[1].snapshot.lines[0].quantity)).toBe(3);
  });

  it('records the actor, action and reason set for the transaction', async () => {
    await tx(async (c) => {
      await c.query(
        `SELECT set_config('khatario.invoice_actor_id', $1, true),
                set_config('khatario.invoice_action', 'amended', true),
                set_config('khatario.invoice_reason', 'Wrong PO', true)`,
        [USER],
      );
      await c.query(`UPDATE invoices SET purchase_order_number = 'PO-2' WHERE id = $1`, [INV]);
    });
    const last = (await revisions(INV)).pop();
    expect(last).toMatchObject({ action: 'amended', reason: 'Wrong PO', actor_user_id: USER, actor_name: 'Owner' });
  });

  it('records a change without context as updated by no one', async () => {
    await pool.query(`UPDATE invoices SET notes = 'Newer' WHERE id = $1`, [INV]);
    const last = (await revisions(INV)).pop();
    expect(last).toMatchObject({ action: 'updated', reason: null, actor_user_id: null, actor_name: null });
  });

  it('ignores a customer opening the invoice link', async () => {
    const before = (await revisions(INV)).length;
    await pool.query(
      `UPDATE invoices SET view_count = COALESCE(view_count, 0) + 1, last_viewed_at = now(),
              first_viewed_at = now(), public_token = $2, updated_at = now() WHERE id = $1`,
      [INV, `tok-${tag}`],
    );
    expect(await revisions(INV)).toHaveLength(before);
  });

  it('records nothing for a rolled-back change', async () => {
    const before = (await revisions(INV)).length;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE invoices SET notes = 'Never' WHERE id = $1`, [INV]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await revisions(INV)).toHaveLength(before);
  });

  it('records a change to a line alone', async () => {
    const before = (await revisions(INV)).length;
    await pool.query(`UPDATE invoice_items SET quantity = 5 WHERE invoice_id = $1 AND sort_order = 1`, [INV]);
    const rows = await revisions(INV);
    expect(rows).toHaveLength(before + 1);
    expect(Number(rows[rows.length - 1].snapshot.lines[1].quantity)).toBe(5);
  });

  it('has an index for loading the lines of an invoice', async () => {
    const res = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'invoice_items' AND indexdef ~ '\(invoice_id\)'`,
    );
    expect(res.rowCount).toBeGreaterThan(0);
  });

  it('records no revision for a customer view after new columns are added', async () => {
    const before = (await revisions(INV)).length;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query(`ALTER TABLE invoices ADD COLUMN zz_hist_flag BOOLEAN NOT NULL DEFAULT false`);
      await client.query(`ALTER TABLE invoices ADD COLUMN zz_hist_note TEXT`);
      await client.query(`ALTER TABLE invoice_items ADD COLUMN zz_hist_unit TEXT NOT NULL DEFAULT 'pc'`);
      await client.query(`UPDATE invoices SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1`, [INV]);
      const inside = await client.query(`SELECT count(*)::int AS n FROM invoice_revisions WHERE invoice_id = $1`, [INV]);
      expect(inside.rows[0].n).toBe(before);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('refuses to change or delete history', async () => {
    await expect(pool.query(`UPDATE invoice_revisions SET reason = 'x' WHERE invoice_id = $1`, [INV])).rejects.toThrow(
      /invoice history cannot be changed/,
    );
    await expect(pool.query(`DELETE FROM invoice_revisions WHERE invoice_id = $1`, [INV])).rejects.toThrow(
      /invoice history cannot be changed/,
    );
    await expect(
      tx((c) => c.query(`TRUNCATE invoice_revisions`)),
    ).rejects.toThrow(/invoice history cannot be changed/);
  });

  it('keeps history when the invoice row is deleted and continues it when a restore brings it back', async () => {
    const id = randomUUID();
    await insertFinalInvoice(id, `DEL-${tag}`);
    expect(await revisions(id)).toHaveLength(1);

    // What backup restore does: delete the business's invoices, then insert them again by id.
    await tx(async (c) => {
      await c.query(
        `SELECT set_config('khatario.invoice_actor_id', $1, true),
                set_config('khatario.invoice_action', 'restored', true),
                set_config('khatario.invoice_reason', 'Restored from backup', true)`,
        [USER],
      );
      await c.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id]);
      await c.query(`DELETE FROM invoices WHERE id = $1`, [id]);
      await c.query(
        `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type,
                               place_of_supply_state_code, notes, is_editable)
         VALUES ($1, $2, $3, $4, $5, $6::date, 'final', 'tax_invoice', '29', 'From backup', false)`,
        [id, B, BR, CUST, `DEL-${tag}`, DAY],
      );
      await insertItem(c, id, 0, 'Rice', 2);
    });
    const rows = await revisions(id);
    expect(rows.map((r) => r.revision_no)).toEqual([1, 2]);
    expect(rows[1]).toMatchObject({ action: 'restored', reason: 'Restored from backup', actor_user_id: USER });
    expect(rows[1].snapshot.header.notes).toBe('From backup');

    // An invoice deleted for good keeps its history too.
    await tx(async (c) => {
      await c.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [id]);
      await c.query(`DELETE FROM invoices WHERE id = $1`, [id]);
    });
    expect(await revisions(id)).toHaveLength(2);
  });

  describe('route context', () => {
    const FIN = randomUUID();
    const FIN2 = randomUUID();

    async function call(handler: Function, url: string, method: string, body: unknown, id: string) {
      const res = await handler(
        new NextRequest(`http://localhost${url}`, { method, headers, body: JSON.stringify(body) }),
        { params: { id } },
      );
      return { status: res.status as number, json: await res.json() };
    }

    beforeAll(async () => {
      await insertFinalInvoice(FIN, `FIN-${tag}`);
      await insertFinalInvoice(FIN2, `FIN2-${tag}`);
    });

    it('amend records action, reason and actor', async () => {
      const { PATCH } = await import('@/app/api/invoices/[id]/amend/route');
      const res = await call(PATCH, `/api/invoices/${FIN}/amend`, 'PATCH', {
        invoice_date: DAY,
        notes: 'New',
        reason: 'Customer asked',
      }, FIN);
      expect(res.status).toBe(200);
      const last = (await revisions(FIN)).pop();
      expect(last).toMatchObject({ action: 'amended', reason: 'Customer asked', actor_user_id: USER });
      expect(last.snapshot.header.notes).toBe('New');
    });

    it('amend refuses a reason longer than 500 characters and records nothing', async () => {
      const { PATCH } = await import('@/app/api/invoices/[id]/amend/route');
      const before = (await revisions(FIN)).length;
      const res = await call(PATCH, `/api/invoices/${FIN}/amend`, 'PATCH', {
        invoice_date: DAY,
        notes: 'Other',
        reason: 'x'.repeat(501),
      }, FIN);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('REASON_TOO_LONG');
      expect(await revisions(FIN)).toHaveLength(before);
    });

    it('e-way bill update is recorded with its actor', async () => {
      const { PATCH } = await import('@/app/api/invoices/[id]/eway/route');
      const res = await call(PATCH, `/api/invoices/${FIN}/eway`, 'PATCH', {
        eway_bill_number: '331234567890',
        eway_bill_date: DAY,
      }, FIN);
      expect(res.status).toBe(200);
      const last = (await revisions(FIN)).pop();
      expect(last).toMatchObject({ action: 'eway_updated', actor_user_id: USER });
    });

    it('cancel records the cancel reason', async () => {
      const { PATCH } = await import('@/app/api/invoices/[id]/cancel/route');
      const res = await call(PATCH, `/api/invoices/${FIN2}/cancel`, 'PATCH', { reason: 'Duplicate' }, FIN2);
      expect(res.status).toBe(200);
      const last = (await revisions(FIN2)).pop();
      expect(last).toMatchObject({ action: 'cancelled', reason: 'Duplicate', actor_user_id: USER });
    });

    it('locks 500 invoices in one statement with one revision each in under 10 seconds', async () => {
      const ids = Array.from({ length: 500 }, () => randomUUID());
      await pool.query(
        `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type,
                               place_of_supply_state_code, is_editable)
         SELECT id, $2, $3, $4, 'BULK-' || $5 || '-' || ord, $6::date, 'final', 'tax_invoice', '29', true
           FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)`,
        [ids, B, BR, CUST, tag, DAY],
      );
      const started = Date.now();
      await tx(async (c) => {
        await c.query(
          `SELECT set_config('khatario.invoice_actor_id', $1, true),
                  set_config('khatario.invoice_action', 'gstr1_locked', true),
                  set_config('khatario.invoice_reason', 'GSTR-1 filed for 2026-10', true)`,
          [USER],
        );
        await c.query(`UPDATE invoices SET is_editable = false WHERE id = ANY($1::uuid[])`, [ids]);
      });
      const elapsed = Date.now() - started;
      const locked = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM invoice_revisions WHERE invoice_id = ANY($1::uuid[]) AND action = 'gstr1_locked'`,
        [ids],
      );
      expect(locked.rows[0].n).toBe('500');
      expect(elapsed).toBeLessThan(10000);
    });
  });
});
