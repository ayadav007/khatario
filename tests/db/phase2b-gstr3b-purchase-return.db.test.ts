/**
 * Phase 2B: GSTR-3B ITC for the original freight bill and a 4-unit unrefunded return.
 * Writes only after current_database() is kh_phase2_test on port 5433.
 * The report is not changed to subtract purchase_returns; this locks the ledger contract.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

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
    throw new Error('Refusing purchase tests: database host is not local');
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
jest.mock('@/lib/enforce-access', () => ({
  ...jest.requireActual('@/lib/enforce-access'),
  enforceAccess: jest.fn().mockResolvedValue(undefined),
  enforceAccessErrorResponse: jest.fn(() => null),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createPurchaseInTransaction } from '@/lib/purchases/purchase-create-service';
import { GSTR3BGenerator } from '@/lib/gst/gstr3b';
import { POST as postReturn } from '@/app/api/purchase-returns/route';
import { NextRequest } from 'next/server';

const DAY = '2026-10-09';

describe('phase 2B GSTR-3B purchase return', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const B = randomUUID();
  const BR = randomUUID();
  const USER = randomUUID();
  const SUP = randomUUID();
  const ITEM = randomUUID();
  const SVC = randomUUID();

  async function assertDb(client: Pool | PoolClient) {
    const info = (
      await client.query<{ db: string; port: number; addr: string }>(
        `SELECT current_database() AS db, inet_server_port() AS port, inet_server_addr()::text AS addr`
      )
    ).rows[0];
    const addr = info.addr || '';
    const local = addr.startsWith('127.') || addr.startsWith('::1') || addr === '';
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !local) {
      throw new Error(`Refusing to mutate ${info.db} on ${info.addr}:${info.port}`);
    }
  }

  beforeAll(async () => {
    pool = getPool();
    await assertDb(pool);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, state, gst_registration_type)
       VALUES ($1,$2,'27AABCU9603R1ZM','27','Maharashtra','regular')`,
      [B, `Phase2B ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1,$2,'Main','27',true,true,true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1,$2,'Clerk',$3,true)`,
      [USER, B, `8${Date.now().toString().slice(-9)}`]
    );
    await pool.query(`UPDATE users SET auth_session_version = 1, is_active = true WHERE id = $1`, [USER]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance)
       VALUES ($1,$2,'Mill','27','27AABCM1234R1Z5',0)`,
      [SUP, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1,$2,'Cotton','goods','NOS',1000,1000,18,'6109'),
              ($3,$2,'Haulage','service','NOS',0,0,18,'9965')`,
      [ITEM, B, SVC]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,0)`,
      [B, BR, ITEM]
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, warehouses_enabled, inventory_model)
       VALUES ($1, false, 'perpetual')
       ON CONFLICT (business_id) DO UPDATE SET warehouses_enabled = false, inventory_model = 'perpetual'`,
      [B]
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assertDb(client);
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM businesses WHERE id = $1`, [B]);
      });
      await client.query('COMMIT');
    } finally {
      client.release();
      await closePool();
    }
  });

  test('input CGST of 630 is the ledger after the unrefunded return, not a second subtraction', async () => {
    const client = await pool.connect();
    let purchaseId = '';
    try {
      await client.query('BEGIN');
      await assertDb(client);
      const created = await createPurchaseInTransaction(client, {
        business_id: B,
        created_by: USER,
        branch_id: BR,
        supplier_id: SUP,
        bill_number: `P2B-${tag}`,
        bill_date: DAY,
        status: 'final',
        itc_eligible: true,
        place_of_supply_state_code: '27',
        supplier_state_code: '27',
        items: [{ item_id: ITEM, item_name: 'Cotton', quantity: 10, unit_price: 1000, tax_rate: 18, hsn_sac: '6109' }],
        charges: [{ purpose: 'Freight', amount: 1000, classification: 'incidental_to_goods', tax_rate: 18, hsn_sac: '9965' }],
      });
      await client.query('COMMIT');
      purchaseId = String(created.purchase.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const header = (
      await pool.query<{ subtotal: string; tax_total: string; cgst_total: string; grand_total: string }>(
        `SELECT subtotal::text, tax_total::text, cgst_total::text, grand_total::text FROM purchases WHERE id = $1`,
        [purchaseId]
      )
    ).rows[0];
    expect(Number(header.subtotal)).toBe(11000);
    expect(Number(header.tax_total)).toBe(1980);
    expect(Number(header.cgst_total)).toBe(990);
    expect(Number(header.grand_total)).toBe(12980);

    const charge = (
      await pool.query<{ taxable: string; tax: string }>(
        `SELECT taxable_value::text AS taxable, tax_amount::text AS tax FROM purchase_charges WHERE purchase_id = $1`,
        [purchaseId]
      )
    ).rows[0];
    expect(Number(charge.taxable)).toBe(1000);
    expect(Number(charge.tax)).toBe(180);

    const response = await postReturn(
      new NextRequest('http://localhost/api/purchase-returns', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-authenticated-user-id': USER,
          'x-authenticated-business-id': B,
          'x-authenticated-session-version': '1',
        },
        body: JSON.stringify({
          purchase_id: purchaseId,
          return_number: `PR-P2B-${tag}`,
          return_date: DAY,
          refund_incidental_charges: false,
          items: [{ item_id: ITEM, qty: 4 }],
        }),
      })
    );
    const body = await response.json();
    expect(response.status).toBe(201);
    const note = (
      await pool.query<{ subtotal: string; tax_total: string; cgst_total: string; grand_total: string; status: string }>(
        `SELECT subtotal::text, tax_total::text, cgst_total::text, grand_total::text, status
           FROM purchase_returns WHERE id = $1`,
        [body.purchaseReturn.id]
      )
    ).rows[0];
    expect(Number(note.subtotal)).toBe(4000);
    expect(Number(note.tax_total)).toBe(720);
    expect(Number(note.cgst_total)).toBe(360);
    expect(Number(note.grand_total)).toBe(4720);
    expect(note.status).not.toBe('cancelled');

    const input = (
      await pool.query<{ voucher_type: string; debit: string; credit: string }>(
        `SELECT l.voucher_type, SUM(l.debit)::text AS debit, SUM(l.credit)::text AS credit
           FROM ledger_entry_lines l
           JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND a.account_code = '1110'
          GROUP BY l.voucher_type
          ORDER BY l.voucher_type`,
        [B]
      )
    ).rows;
    const byType = new Map(input.map((row) => [row.voucher_type, row]));
    expect(Number(byType.get('purchase')?.debit)).toBe(990);
    expect(Number(byType.get('purchase_return')?.credit)).toBe(360);
    const ledgerCgst = 990 - 360;

    const report = await new GSTR3BGenerator().generate({ business_id: B, month: 10, year: 2026 });
    expect(report.ledger_basis.itc.cgst).toBe(ledgerCgst);
    expect(report.ledger_basis.itc.sgst).toBe(630);
    expect(report.itc_details.other_itc.cgst).toBe(630);
    expect(report.itc_details.other_itc.sgst).toBe(630);
    expect(report.itc_details.net_itc.cgst).toBe(630);
    expect(report.itc_available.cgst).toBe(630);
    // The bill header is still the full ₹990. The report must not subtract the return again.
    expect(report.ledger_basis.itc.cgst).toBe(630);
    expect(report.ledger_basis.itc.cgst).not.toBe(990 - 360 - 360);
  });

  test('a supplier credit note reduces the same input-GST ledger once', async () => {
    const before = await new GSTR3BGenerator().generate({ business_id: B, month: 10, year: 2026 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assertDb(client);
      const note = await createPurchaseInTransaction(client, {
        business_id: B,
        created_by: USER,
        branch_id: BR,
        supplier_id: SUP,
        bill_number: `SCN-P2B-${tag}`,
        bill_date: DAY,
        status: 'final',
        document_type: 'supplier_credit_note',
        place_of_supply_state_code: '27',
        supplier_state_code: '27',
        items: [{ item_id: SVC, item_name: 'Haulage', item_type: 'service', quantity: 1, unit_price: 1000, tax_rate: 18, hsn_sac: '9965' }],
      });
      await client.query('COMMIT');
      const books = (
        await pool.query<{ debit: string; credit: string; voucher_type: string }>(
          `SELECT l.voucher_type, SUM(l.debit)::text AS debit, SUM(l.credit)::text AS credit
             FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
            WHERE l.voucher_id = $1 AND a.account_code = '1110'
            GROUP BY l.voucher_type`,
          [note.purchase.id]
        )
      ).rows[0];
      expect(books.voucher_type).toBe('supplier_credit_note');
      expect(Number(books.credit)).toBe(90);
      expect(Number(books.debit)).toBe(0);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const after = await new GSTR3BGenerator().generate({ business_id: B, month: 10, year: 2026 });
    expect(after.ledger_basis.itc.cgst).toBe(before.ledger_basis.itc.cgst - 90);
    expect(after.itc_details.net_itc.cgst).toBe(before.itc_details.net_itc.cgst - 90);
  });
});
