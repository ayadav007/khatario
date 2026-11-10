/**
 * Invoice History API: revisions newest first with field-level changes, legacy activity rows
 * after them, one revision's snapshot, and business isolation.
 * Writes only after current_database() is kh_phase2_test on localhost.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
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
    throw new Error('Refusing invoice history tests: database host is not local');
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
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { PATCH as amendInvoice } from '@/app/api/invoices/[id]/amend/route';
import { GET as getHistory } from '@/app/api/invoices/[id]/history/route';
import { GET as getRevision } from '@/app/api/invoices/[id]/history/[revision]/route';

const MIGRATION = fs.readFileSync(
  path.resolve(process.cwd(), 'database/migrations/469_invoice_revisions.sql'),
  'utf8',
);
const DAY = '2026-10-20';

describe('invoice history API (kh_phase2_test)', () => {
  jest.setTimeout(180000);
  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const BR = randomUUID();
  const USER = randomUUID();
  const USER2 = randomUUID();
  const CUST = randomUUID();
  const INV = randomUUID();
  const tag = B.slice(0, 8);

  function headersFor(user: string, business: string) {
    return {
      'content-type': 'application/json',
      'x-authenticated-user-id': user,
      'x-authenticated-business-id': business,
      'x-authenticated-session-version': '1',
    };
  }

  async function history(user = USER, business = B) {
    const res = await getHistory(
      new NextRequest(`http://localhost/api/invoices/${INV}/history`, { headers: headersFor(user, business) }),
      { params: { id: INV } },
    );
    return { status: res.status, json: await res.json() };
  }

  async function revision(no: string) {
    const res = await getRevision(
      new NextRequest(`http://localhost/api/invoices/${INV}/history/${no}`, { headers: headersFor(USER, B) }),
      { params: { id: INV, revision: no } },
    );
    return { status: res.status, json: await res.json() };
  }

  beforeAll(async () => {
    pool = getPool();
    const info = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (info.rows[0]?.db !== 'kh_phase2_test') throw new Error(`Refusing to mutate database ${info.rows[0]?.db}`);
    await pool.query(MIGRATION);

    for (const [biz, user, phoneTail] of [
      [B, USER, '1'],
      [B2, USER2, '2'],
    ]) {
      await pool.query(
        `INSERT INTO businesses (id, name, state, state_code, gst_registration_type) VALUES ($1, $2, 'Karnataka', '29', 'regular')`,
        [biz, `History ${tag} ${phoneTail}`],
      );
      await pool.query(
        `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
         VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
        [user, biz, `7${Date.now().toString().slice(-8)}${phoneTail}`],
      );
    }
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '29', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state, state_code) VALUES ($1, $2, 'Shalini', 'Karnataka', '29')`,
      [CUST, B],
    );
    await pool.query(
      `INSERT INTO activity_logs (business_id, user_id, action_type, module, entity_id, entity_type, description, created_at)
       VALUES ($1, $2, 'create', 'invoices', $3, 'invoice', 'Created invoice (old log)', now() - interval '1 day')`,
      [B, USER, INV],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type,
                               place_of_supply_state_code, notes, is_editable)
         VALUES ($1, $2, $3, $4, $5, $6::date, 'final', 'tax_invoice', '29', 'Old', false)`,
        [INV, B, BR, CUST, `HIS-${tag}`, DAY],
      );
      await client.query(
        `INSERT INTO invoice_items (invoice_id, item_name, quantity, unit_price, line_total, sort_order)
         VALUES ($1, 'Rice', 2, 100, 200, 0)`,
        [INV],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const res = await amendInvoice(
      new NextRequest(`http://localhost/api/invoices/${INV}/amend`, {
        method: 'PATCH',
        headers: headersFor(USER, B),
        body: JSON.stringify({ invoice_date: DAY, notes: 'New', reason: 'Customer asked' }),
      }),
      { params: { id: INV } },
    );
    if (res.status !== 200) throw new Error(`amend failed: ${res.status} ${JSON.stringify(await res.json())}`);
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, B2]]);
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

  it('lists revisions newest first with their changes', async () => {
    const res = await history();
    expect(res.status).toBe(200);
    const [latest] = res.json.history;
    expect(latest).toMatchObject({
      kind: 'revision',
      revision_no: 2,
      action: 'amended',
      action_label: 'Amended',
      reason: 'Customer asked',
      user_name: 'Owner',
    });
    expect(latest.description).toBe(`Amended HIS-${tag}: Notes`);
    expect(latest.diff.header).toEqual([{ field: 'notes', label: 'Notes', before: 'Old', after: 'New' }]);
  });

  it('shows no changes for the first revision', async () => {
    const res = await history();
    const first = res.json.history.find((h: { revision_no: number | null }) => h.revision_no === 1);
    expect(first).toMatchObject({ action: 'created', user_name: null });
    expect(first.diff).toEqual({ header: [], lines: [], charges: [] });
  });

  it('puts activity logged before history started after the revisions', async () => {
    const res = await history();
    const last = res.json.history[res.json.history.length - 1];
    expect(last).toMatchObject({ kind: 'activity', description: 'Created invoice (old log)', diff: null });
    expect(res.json.history).toHaveLength(3);
  });

  it('does not show another business its history', async () => {
    const res = await history(USER2, B2);
    expect(res.status).toBe(404);
  });

  it('returns one revision with its full snapshot', async () => {
    const res = await revision('1');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ revision_no: 1, action: 'created', action_label: 'Created' });
    expect(res.json.snapshot.lines).toHaveLength(1);
    expect(res.json.snapshot.header.notes).toBe('Old');
  });

  it('answers 404 for a revision that does not exist', async () => {
    const res = await revision('99');
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('REVISION_NOT_FOUND');
    expect((await revision('abc')).status).toBe(404);
  });
});
