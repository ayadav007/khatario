/**
 * Receivables / payables ageing against the scenario run in Zoho Books (Tandoor Studio,
 * docs/qa/reports-zoho-vs-khatario/02-receivables-payables-aging.md). Runs only when
 * PHASE2_TEST_DATABASE_URL points at a disposable database; migration 336 is applied in beforeAll.
 *
 * As of 2026-09-30 Zoho shows (aged by due date):
 *   Customer A  current 2,360 | 31-45 4,720 | >45 6,800  (+ 3,000 unapplied credit)  balance 10,880
 *   Customer B  >45 23,600
 *   Supplier X  current 4,720 | >45 9,410               (+ 1,500 excess payment)    balance 12,630
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
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
  assertReportAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => '127.0.0.1'),
  getUserAgent: jest.fn(() => 'jest'),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import {
  createInvoiceLedgerEntries,
  createPurchaseLedgerEntries,
  createCreditNoteLedgerEntries,
  createPurchaseReturnLedgerEntries,
} from '@/lib/ledger-utils';
import { createAdvance, adjustAdvance } from '@/lib/accounting/advance-service';
import { POST as postPayment } from '@/app/api/payments/route';
import { POST as postPurchase } from '@/app/api/purchases/route';
import { GET as agingReceivables } from '@/app/api/reports/aging/receivables/route';
import { GET as agingPayables } from '@/app/api/reports/aging/payables/route';

const migration336 = fs.readFileSync(path.join(__dirname, '../../database/migrations/336_purchase_due_date.sql'), 'utf8');

d('Ageing vs Zoho scenario (real DB)', () => {
  jest.setTimeout(180000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const CA = randomUUID();
  const CB = randomUUID();
  const CC = randomUUID();
  const SX = randomUUID();
  const tag = B.slice(0, 8);
  const inv: Record<string, string> = {};
  const bill: Record<string, string> = {};

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  const req = (p: string, method = 'GET', body?: unknown) =>
    new NextRequest(`http://localhost${p}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-authenticated-user-id': U, 'x-authenticated-business-id': B },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    return { status: r.status, json: (await r.json()) as any };
  };

  async function invoice(key: string, customer: string, date: string, due: string, total: number) {
    const id = randomUUID();
    const number = `${key}-${tag}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, due_date, status, document_type,
            place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
            paid_amount, balance_amount, payment_status, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'final', 'tax_invoice', '29', $7, 0, 0, 0, 0, $7, 0, $7, 'unpaid', $8)`,
        [id, B, customer, number, date, due, total, BR]
      );
      await createInvoiceLedgerEntries({
        businessId: B, invoiceId: id, invoiceNumber: number, invoiceDate: date, grandTotal: total,
        customerId: customer, isCashSale: false, branchId: BR, taxableValue: total, poolClient: c,
      });
      await c.query(`UPDATE customers SET current_balance = current_balance + $1 WHERE id = $2`, [total, customer]);
    });
    inv[key] = id;
    return id;
  }

  async function purchase(key: string, date: string, due: string, total: number) {
    const id = randomUUID();
    await tx(async (c) => {
      await c.query(
        `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, due_date, status, place_of_supply_state_code,
            is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
            paid_amount, balance_amount, payment_status, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'final', '29', false, true, $7, 0, 0, 0, 0, $7, 0, $7, 'unpaid', $8)`,
        [id, B, SX, key, date, due, total, BR]
      );
      await createPurchaseLedgerEntries({
        businessId: B, purchaseId: id, purchaseNumber: key, purchaseDate: date, grandTotal: total,
        supplierId: SX, isCashPurchase: false, branchId: BR, taxableValue: total, poolClient: c,
      });
      await c.query(`UPDATE suppliers SET current_balance = current_balance + $1 WHERE id = $2`, [total, SX]);
    });
    bill[key] = id;
    return id;
  }

  const pay = async (body: Record<string, unknown>) => {
    const res = await call(postPayment(req('/api/payments', 'POST', { payment_mode: 'cash', ...body })));
    expect(res.status).toBe(201);
    return res.json.payment;
  };

  const ar = (asOf: string, extra = '') => call(agingReceivables(req(`/api/reports/aging/receivables?as_on_date=${asOf}${extra}`)));
  const ap = (asOf: string, extra = '') => call(agingPayables(req(`/api/reports/aging/payables?as_on_date=${asOf}${extra}`)));
  const party = (rows: any[], id: string) => rows.find((r) => r.party_id === id);

  beforeAll(async () => {
    pool = getPool();
    await tx((c) => c.query(migration336));
    await tx((c) => c.query(migration336));

    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '29AAGCQ4321A1ZS', '29', 'regular')`,
      [B, `Ageing ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '29', true, true, true)`,
      [BR, B]
    );
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`, [
      U,
      B,
      `93${Date.now().toString().slice(-8)}`,
    ]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, credit_limit)
       VALUES ($1, $4, 'QA-AG Customer A', '29', 0, 20000), ($2, $4, 'QA-AG Customer B', '29', 0, 0), ($3, $4, 'QA-AG Customer C', '29', 0, 0)`,
      [CA, CB, CC, B]
    );
    await pool.query(`INSERT INTO suppliers (id, business_id, name, state_code, current_balance) VALUES ($1, $2, 'QA-AG Supplier X', '29', 0)`, [
      SX,
      B,
    ]);

    await invoice('A1', CA, '2026-06-01', '2026-06-16', 11800);
    await invoice('A2', CA, '2026-08-15', '2026-08-30', 5900);
    await invoice('A3', CA, '2026-09-25', '2026-10-10', 2360);
    await invoice('B1', CB, '2026-04-10', '2026-04-10', 23600);
    await pay({ type: 'receivable', reference_type: 'invoice', reference_id: inv.A1, amount: 5000, payment_date: '2026-07-01' });
    await pay({ type: 'receivable', customer_id: CA, amount: 3000, payment_date: '2026-09-20' });
    await pay({ type: 'receivable', reference_type: 'invoice', reference_id: inv.A1, amount: 1000, payment_date: '2026-10-01' });

    const cnId = randomUUID();
    await tx(async (c) => {
      await c.query(
        `INSERT INTO credit_notes (id, business_id, customer_id, invoice_id, credit_note_number, credit_note_date, status,
            subtotal, grand_total, branch_id)
         VALUES ($1, $2, $3, $4, $5, '2026-09-01', 'active', 1180, 1180, $6)`,
        [cnId, B, CA, inv.A2, `CN1-${tag}`, BR]
      );
      await createCreditNoteLedgerEntries({
        businessId: B, creditNoteId: cnId, creditNoteNumber: `CN1-${tag}`, creditNoteDate: '2026-09-01',
        grandTotal: 1180, customerId: CA, branchId: BR, taxableValue: 1180, poolClient: c,
      });
    });

    await purchase('X1', '2026-06-05', '2026-07-05', 17700);
    await purchase('X2', '2026-09-10', '2026-10-10', 4720);
    await pay({ type: 'payable', reference_type: 'purchase', reference_id: bill.X1, amount: 7700, payment_date: '2026-07-10' });
    await pay({ type: 'payable', supplier_id: SX, amount: 1500, payment_date: '2026-09-15' });
    const prId = randomUUID();
    await tx(async (c) => {
      await c.query(
        `INSERT INTO purchase_returns (id, business_id, purchase_id, supplier_id, return_number, return_date, status, subtotal, grand_total, branch_id)
         VALUES ($1, $2, $3, $4, $5, '2026-08-01', 'final', 590, 590, $6)`,
        [prId, B, bill.X1, SX, `VC1-${tag}`, BR]
      );
      await createPurchaseReturnLedgerEntries({
        businessId: B, purchaseReturnId: prId, returnNumber: `VC1-${tag}`, returnDate: '2026-08-01',
        grandTotal: 590, supplierId: SX, branchId: BR, taxableValue: 590, poolClient: c,
      });
    });

    // Customer C: a GST advance (advances module) adjusted against a later invoice.
    const C1 = await invoice('C1', CC, '2026-09-01', '2026-09-15', 5000);
    const cash = (await pool.query(`SELECT id FROM accounts WHERE business_id = $1 AND account_code = '1101'`, [B])).rows[0].id;
    await tx(async (c) => {
      const adv = await createAdvance(c, {
        businessId: B, branchId: BR, userId: U, type: 'received', partyId: CC, amount: 2000, date: '2026-08-20',
        supplyType: 'goods', taxRate: 0, paymentAccountId: cash,
      });
      await adjustAdvance(c, { businessId: B, branchId: BR, userId: U, advanceId: adv.id, invoiceId: C1, amount: 2000, date: '2026-09-05' });
    });
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', U, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test('receivables as of 30 Sep match Zoho net of the unapplied receipt', async () => {
    const res = await ar('2026-09-30');
    expect(res.status).toBe(200);
    const a = party(res.json.aging, CA);
    // Zoho: current 2,360, 31-45 4,720, >45 6,800, unapplied credit 3,000 → balance 10,880.
    // Khatario sets the on-account receipt off against the oldest invoice (A1).
    expect(a).toMatchObject({
      customer_id: CA,
      bucket_not_due: 2360,
      bucket_0_30: 0,
      bucket_31_60: 4720,
      bucket_61_90: 0,
      bucket_90_plus: 3800,
      on_account: 0,
      total_outstanding: 10880,
    });
    const items = Object.fromEntries(a.transactions.map((t: any) => [t.reference_number, t]));
    expect(items[`A1-${tag}`]).toMatchObject({ outstanding: 3800, due_date: '2026-06-16', days_overdue: 106 });
    expect(items[`A2-${tag}`]).toMatchObject({ outstanding: 4720, days_overdue: 31 });
    expect(items[`A3-${tag}`]).toMatchObject({ outstanding: 2360, days_overdue: -10 });

    expect(party(res.json.aging, CB)).toMatchObject({ bucket_90_plus: 23600, total_outstanding: 23600 });
    expect(a.credit_limit).toBe(20000);
    expect(res.json.totals.total_outstanding).toBeCloseTo(res.json.gl_balance, 2);
  });

  test('a receipt dated after the as-of date is excluded; on 1 Oct it counts', async () => {
    const before = party((await ar('2026-09-30')).json.aging, CA);
    const after = party((await ar('2026-10-01')).json.aging, CA);
    expect(after.total_outstanding).toBeCloseTo(before.total_outstanding - 1000, 2);
    expect(party((await ar('2026-06-30')).json.aging, CA)).toMatchObject({ total_outstanding: 11800, bucket_0_30: 11800 });
    expect(party((await ar('2026-07-01')).json.aging, CA)).toMatchObject({ total_outstanding: 6800, bucket_0_30: 6800 });
  });

  test('an advance adjusted against an invoice settles that invoice for the right customer', async () => {
    const res = await ar('2026-09-30');
    const c = party(res.json.aging, CC);
    expect(c).toMatchObject({ total_outstanding: 3000, bucket_0_30: 3000 });
    expect(c.transactions).toHaveLength(1);
    expect(c.transactions[0]).toMatchObject({ reference_number: `C1-${tag}`, outstanding: 3000 });
    expect(res.json.aging.some((r: any) => r.party_id === null)).toBe(false);
  });

  test('payables as of 30 Sep are aged by bill due date and match the Zoho vendor balance', async () => {
    const res = await ap('2026-09-30');
    expect(res.status).toBe(200);
    const x = party(res.json.aging, SX);
    // Zoho: current 4,720, >45 9,410, excess payment 1,500 → balance 12,630.
    expect(x).toMatchObject({
      supplier_id: SX,
      bucket_not_due: 4720,
      bucket_61_90: 7910,
      total_outstanding: 12630,
    });
    const items = Object.fromEntries(x.transactions.map((t: any) => [t.reference_number, t]));
    expect(items.X1).toMatchObject({ due_date: '2026-07-05', days_overdue: 87, outstanding: 7910 });
    expect(items.X2).toMatchObject({ due_date: '2026-10-10', days_overdue: -10, outstanding: 4720 });
    expect(res.json.totals.total_outstanding).toBeCloseTo(res.json.gl_balance, 2);
  });

  test('customer filter and branch filter', async () => {
    const one = await ar('2026-09-30', `&customer_id=${CB}`);
    expect(one.json.aging.map((r: any) => r.party_id)).toEqual([CB]);
    const branch = await ar('2026-09-30', `&branch_id=${BR}`);
    expect(party(branch.json.aging, CA).total_outstanding).toBe(10880);
  });

  test('purchase POST rejects a due date before the bill date', async () => {
    const res = await call(
      postPurchase(
        req('/api/purchases', 'POST', {
          supplier_id: SX,
          bill_date: '2026-09-10',
          due_date: '2026-09-01',
          items: [{ item_name: 'x', quantity: 1, unit_price: 1, tax_rate: 0 }],
        })
      )
    );
    expect(res.status).toBe(400);
    expect(res.json.code).toBe('INVALID_DUE_DATE');
    await expect(
      pool.query(`UPDATE purchases SET due_date = '2026-01-01' WHERE id = $1`, [bill.X2])
    ).rejects.toThrow(/purchases_due_date_after_bill_date/);
  });
});
