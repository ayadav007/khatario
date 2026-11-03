/**
 * Amending a final invoice: the printed fields that do not touch the tax, and the GSTR-1 lock.
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
    throw new Error('Refusing invoice amend tests: database host is not local');
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
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { PATCH as amendInvoice } from '@/app/api/invoices/[id]/amend/route';
import { GET as getInvoice } from '@/app/api/invoices/[id]/route';

const DAY = '2026-10-20';

describe('invoice amend fields (kh_phase2_test)', () => {
  jest.setTimeout(120000);
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

  async function amend(body: Record<string, unknown>) {
    const res = await amendInvoice(
      new NextRequest(`http://localhost/api/invoices/${INV}/amend`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      }),
      { params: { id: INV } },
    );
    return { status: res.status, json: await res.json() };
  }

  async function fetchInvoice() {
    const res = await getInvoice(
      new NextRequest(`http://localhost/api/invoices/${INV}?user_id=${USER}`, { headers }),
      { params: { id: INV } },
    );
    return { status: res.status, json: await res.json() };
  }

  beforeAll(async () => {
    pool = getPool();
    const info = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (info.rows[0]?.db !== 'kh_phase2_test') throw new Error(`Refusing to mutate database ${info.rows[0]?.db}`);

    await pool.query(
      `INSERT INTO businesses (id, name, state, state_code, gst_registration_type) VALUES ($1, $2, 'Karnataka', '29', 'regular')`,
      [B, `Amend fields ${tag}`],
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
    // GSTIN says Delhi, goods go to Bengaluru: the saved place of supply is Karnataka.
    await pool.query(
      `INSERT INTO customers (id, business_id, name, gstin, state, state_code)
       VALUES ($1, $2, 'Shalini', '07ABCDE1234F2Z5', 'Karnataka', '29')`,
      [CUST, B],
    );
    await pool.query(
      `INSERT INTO invoices (id, business_id, branch_id, customer_id, invoice_number, invoice_date, status, document_type,
                             place_of_supply_state_code, shipping_address, notes, purchase_order_number, is_editable)
       VALUES ($1, $2, $3, $4, $5, $6::date, 'final', 'tax_invoice', '29', 'Old ship-to', 'Old notes', 'PO-OLD', false)`,
      [INV, B, BR, CUST, `AMD-${tag}`, DAY],
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

  it('changes ship-to, notes and references, and leaves the place of supply and unsent fields alone', async () => {
    const res = await amend({
      invoice_date: DAY,
      due_date: null,
      billing_address: 'Bill-to street',
      billing_name: 'Shalini',
      shipping_address: '  Survey No. 5/1, Bengaluru 560099  ',
      notes: 'Deliver to gate 2',
      payment_terms: 'NEFT within 15 days',
      purchase_order_date: '2026-10-18',
      eway_bill_number: '331234567890',
      eway_bill_date: '2026-10-20',
      dispatched_through: 'KA-01-AB-1234',
    });
    expect(res.status).toBe(200);

    const row = await pool.query(
      `SELECT shipping_address, notes, payment_terms, purchase_order_number, purchase_order_date::text AS po_date,
              eway_bill_number, eway_bill_date::text AS eway_date, dispatched_through, destination,
              place_of_supply_state_code
         FROM invoices WHERE id = $1`,
      [INV],
    );
    expect(row.rows[0]).toEqual({
      shipping_address: 'Survey No. 5/1, Bengaluru 560099',
      notes: 'Deliver to gate 2',
      payment_terms: 'NEFT within 15 days',
      purchase_order_number: 'PO-OLD',
      po_date: '2026-10-18',
      eway_bill_number: '331234567890',
      eway_date: '2026-10-20',
      dispatched_through: 'KA-01-AB-1234',
      destination: null,
      place_of_supply_state_code: '29',
    });
  });

  it('clears a field sent blank and refuses a bad date', async () => {
    const cleared = await amend({ invoice_date: DAY, billing_address: 'Bill-to street', purchase_order_number: '' });
    expect(cleared.status).toBe(200);
    const row = await pool.query(`SELECT purchase_order_number, notes FROM invoices WHERE id = $1`, [INV]);
    expect(row.rows[0]).toEqual({ purchase_order_number: null, notes: 'Deliver to gate 2' });

    const bad = await amend({ invoice_date: DAY, purchase_order_date: '2026-02-30' });
    expect(bad.status).toBe(400);
  });

  it('locks only once a GSTR-1 holding the invoice is filed, not on is_editable', async () => {
    const filing = randomUUID();
    await pool.query(
      `INSERT INTO gstr1_filings (id, business_id, filing_period, filing_date, status) VALUES ($1, $2, '102026', $3::date, 'draft')`,
      [filing, B, DAY],
    );
    await pool.query(`INSERT INTO gstr1_filing_invoices (gstr1_filing_id, invoice_id) VALUES ($1, $2)`, [filing, INV]);

    const open = await fetchInvoice();
    expect(open.status).toBe(200);
    expect(open.json.invoice.is_editable).toBe(false);
    expect(open.json.invoice.gstr1_filed).toBe(false);
    expect((await amend({ invoice_date: DAY, notes: 'Still open' })).status).toBe(200);

    await pool.query(`UPDATE gstr1_filings SET status = 'filed' WHERE id = $1`, [filing]);
    const filed = await fetchInvoice();
    expect(filed.json.invoice.gstr1_filed).toBe(true);
    const refused = await amend({ invoice_date: DAY, notes: 'Too late' });
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('GSTR1_LOCKED');
  });
});
