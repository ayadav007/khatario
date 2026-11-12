/**
 * Paying an invoice from its reminder link, and the reminder recovery numbers, on a real database.
 * Ravi gets WhatsApp reminders for three bills; he pays one online from the link, part-pays one in
 * cash, and one bill was settled at the counter before his online payment landed.
 * Opt-in, disposable DB only:
 *   INVOICE_PAY_DB_TEST=1 npx jest tests/db/invoice-online-pay-recovery.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test. The test applies migration 474 itself (safe to re-run).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.INVOICE_PAY_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}
const d = enabled ? describe : describe.skip;

jest.mock('@/lib/invoices/payment-received-notify', () => ({
  notifyInvoicePaymentReceived: jest.fn().mockResolvedValue({ sent: true }),
  notifyBillsPaymentReceived: jest.fn().mockResolvedValue({ sent: true }),
  queuePaymentReceivedMessage: jest.fn(),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createInvoiceLedgerEntries } from '@/lib/ledger-utils';
import { postStoreInvoiceReceipt } from '@/lib/store/store-receipt';
import { applyInvoiceGatewayPayment, findInvoiceOnlinePayment } from '@/lib/invoices/online-pay';
import { customerDues } from '@/lib/payment-reminders/statement';
import { getReminderRecoveryReport } from '@/lib/payment-reminders/recovery';
import { notifyBillsPaymentReceived, notifyInvoicePaymentReceived } from '@/lib/invoices/payment-received-notify';

d('invoice online payment and reminder recovery (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const C = randomUUID();
  const tag = B.slice(0, 8);
  const inv: Record<string, string> = {};
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

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

  async function invoice(key: string, total: number) {
    const id = randomUUID();
    const number = `${key}-${tag}`;
    await tx(async (c) => {
      await c.query(
        `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, due_date, status, document_type,
            place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
            paid_amount, balance_amount, payment_status, branch_id, public_token)
         VALUES ($1, $2, $3, $4, $5, $5, 'final', 'tax_invoice', '27', $6, 0, 0, 0, 0, $6, 0, $6, 'unpaid', $7, $8)`,
        [id, B, C, number, today, total, BR, `t${randomUUID().replace(/-/g, '').slice(0, 20)}`],
      );
      await createInvoiceLedgerEntries({
        businessId: B, invoiceId: id, invoiceNumber: number, invoiceDate: today, grandTotal: total,
        customerId: C, isCashSale: false, branchId: BR, taxableValue: total, poolClient: c,
      });
      await c.query(`UPDATE customers SET current_balance = current_balance + $1 WHERE id = $2`, [total, C]);
    });
    inv[key] = id;
    return id;
  }

  async function reminder(invoiceId: string, amountDue: number | null, hoursAgo: number, source = 'auto_overdue') {
    await pool.query(
      `INSERT INTO whatsapp_messages (business_id, to_number, message_type, reference_type, reference_id, message_text,
          status, reminder_source, amount_due, sent_at)
       VALUES ($1, '919800000000', 'reminder', 'invoice', $2, 'Pay please', 'sent', $3, $4, NOW() - ($5 || ' hours')::interval)`,
      [B, invoiceId, source, amountDue, String(hoursAgo)],
    );
  }

  async function onlineRow(invoiceId: string, amount: number) {
    const ref = `plink_${randomUUID().slice(0, 12)}`;
    const r = await pool.query<{ id: string }>(
      `INSERT INTO invoice_online_payments (business_id, invoice_id, customer_id, amount, provider, payment_ref)
       VALUES ($1, $2, $3, $4, 'razorpay', $5) RETURNING id`,
      [B, invoiceId, C, amount, ref],
    );
    return { id: r.rows[0].id, ref };
  }

  const balance = async (id: string) =>
    Number((await pool.query(`SELECT balance_amount FROM invoices WHERE id = $1`, [id])).rows[0].balance_amount);

  beforeAll(async () => {
    pool = getPool();
    for (const f of ['474_invoice_online_payments.sql', '475_customer_bills_statement.sql']) {
      await pool.query(readFileSync(path.join(process.cwd(), 'database/migrations', f), 'utf8'));
    }
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, $3, '27', 'regular')`,
      [B, `Recovery ${tag}`, `27AABCR${tag.slice(0, 4).toUpperCase()}B1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [A, B, `91${String(Date.now()).slice(-10)}`],
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, phone, state_code, current_balance)
       VALUES ($1, $2, 'Ravi', '9800000000', '27', 0)`,
      [C, B],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM whatsapp_messages WHERE business_id = $1`, [B]);
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
    } finally {
      await closePool();
    }
  });

  test('1. paying from the reminder link posts one receipt; a wrong amount and a replay change nothing', async () => {
    const id = await invoice('ONL', 1000);
    await reminder(id, 1000, 3);
    const row = await onlineRow(id, 1000);
    expect(await findInvoiceOnlinePayment('razorpay', { paymentRef: row.ref })).toMatchObject({ id: row.id, business_id: B });

    const wrong = await applyInvoiceGatewayPayment({ invoicePaymentId: row.id, businessId: B, amount: 999, payload: {} });
    expect(wrong).toEqual({ outcome: 'rejected', reason: 'AMOUNT_MISMATCH' });
    expect(await balance(id)).toBe(1000);

    const ok = await applyInvoiceGatewayPayment({
      invoicePaymentId: row.id, businessId: B, amount: 1000, providerPaymentId: `pay_${tag}`,
      payload: { payload: { payment: { entity: { method: 'upi' } } } },
    });
    expect(ok).toMatchObject({ outcome: 'settled', settled: 1000, advance: 0 });
    expect(await balance(id)).toBe(0);
    const pay = await pool.query(
      `SELECT amount, payment_mode FROM payments WHERE business_id = $1 AND reference_type = 'invoice' AND reference_id = $2`,
      [B, id],
    );
    expect(pay.rows).toHaveLength(1);
    expect(Number(pay.rows[0].amount)).toBe(1000);
    expect(notifyInvoicePaymentReceived).toHaveBeenCalledWith(expect.objectContaining({ businessId: B, source: 'online' }));

    const replay = await applyInvoiceGatewayPayment({ invoicePaymentId: row.id, businessId: B, amount: 1000, payload: {} });
    expect(replay).toEqual({ outcome: 'duplicate' });
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE reference_id = $1`, [id]);
    expect(count.rows[0].n).toBe(1);
  });

  test('2. a bill settled at the counter before the online payment lands keeps the money as an advance', async () => {
    const id = await invoice('CTR', 400);
    const row = await onlineRow(id, 400);
    await tx((c) =>
      postStoreInvoiceReceipt(c, {
        businessId: B,
        invoice: { id, customer_id: C, branch_id: BR, invoice_number: `CTR-${tag}` },
        amount: 400, paymentMode: 'cash', createdBy: A, notes: 'Counter', description: 'Counter',
      }),
    );
    const res = await applyInvoiceGatewayPayment({ invoicePaymentId: row.id, businessId: B, amount: 400, payload: {} });
    expect(res).toMatchObject({ outcome: 'settled', settled: 0, advance: 400, paymentId: null });
    expect(await balance(id)).toBe(0);
  });

  test('3. the recovery report counts reminded bills, money in after the first reminder, and the link share', async () => {
    const part = await invoice('PRT', 500);
    await reminder(part, null, 5, 'manual'); // sent before amount_due was stored
    await reminder(part, 500, 1, 'auto_overdue');
    await tx((c) =>
      postStoreInvoiceReceipt(c, {
        businessId: B,
        invoice: { id: part, customer_id: C, branch_id: BR, invoice_number: `PRT-${tag}` },
        amount: 200, paymentMode: 'cash', createdBy: A, notes: 'Cash', description: 'Cash',
      }),
    );
    await invoice('NOREM', 300); // never reminded: not counted

    const r = await getReminderRecoveryReport(B, today, today);
    expect(r.totals.invoices_reminded).toBe(2);
    expect(r.totals.reminders_sent).toBe(3);
    expect(r.totals.chased).toBe(1500); // 1000 + (300 still due + 200 paid since the first reminder)
    expect(r.totals.recovered).toBe(1200);
    expect(r.totals.recovered_via_link).toBe(1000);
    expect(r.totals.pending).toBe(300);
    expect(r.totals.invoices_fully_paid).toBe(1);
    expect(r.by_source).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'auto_overdue', invoices: 1, chased: 1000, recovered: 1000 }),
        expect.objectContaining({ source: 'manual', invoices: 1, chased: 500, recovered: 200 }),
      ]),
    );
    expect(r.invoices[0]).toMatchObject({ invoice_id: inv.ONL, recovered: 1000, via_link: 1000, pending: 0 });
  });
  test('4. one payment for several bills is split oldest first, one receipt per bill; picking bills pays only those', async () => {
    // A second customer so earlier tests' bills do not mix in.
    const C2 = randomUUID();
    await pool.query(
      `INSERT INTO customers (id, business_id, name, phone, state_code, current_balance) VALUES ($1, $2, 'Meena', '9811111111', '27', 0)`,
      [C2, B],
    );
    const mk = async (key: string, total: number, due: string) => {
      const id = await invoice(key, total);
      await pool.query(`UPDATE invoices SET customer_id = $2, due_date = $3 WHERE id = $1`, [id, C2, due]);
      await pool.query(`UPDATE customers SET current_balance = current_balance - $1 WHERE id = $2`, [total, C]);
      await pool.query(`UPDATE customers SET current_balance = current_balance + $1 WHERE id = $2`, [total, C2]);
      return id;
    };
    const oldest = await mk('M1', 3000, '2026-09-01');
    const middle = await mk('M2', 5000, '2026-10-01');
    const newest = await mk('M3', 2000, '2026-11-01');

    const dues = await customerDues(B, C2);
    expect(dues.bills.map((b) => b.id)).toEqual([oldest, middle, newest]);
    expect(dues.billsDue).toBe(10000);
    expect(dues.toPay).toBe(10000);

    // Part of the total: oldest first, the middle bill part paid, the newest untouched.
    const part = await pool.query<{ id: string }>(
      `INSERT INTO invoice_online_payments (business_id, customer_id, amount, provider, payment_ref)
       VALUES ($1, $2, 7000, 'razorpay', $3) RETURNING id`,
      [B, C2, `plink_${randomUUID().slice(0, 12)}`],
    );
    const r1 = await applyInvoiceGatewayPayment({ invoicePaymentId: part.rows[0].id, businessId: B, amount: 7000, payload: {} });
    expect(r1).toMatchObject({ outcome: 'settled', settled: 7000, advance: 0 });
    if (r1.outcome !== 'settled') throw new Error('not settled');
    expect(r1.allocations.map((a) => [a.invoiceId, a.amount])).toEqual([[oldest, 3000], [middle, 4000]]);
    expect(await balance(oldest)).toBe(0);
    expect(await balance(middle)).toBe(1000);
    expect(await balance(newest)).toBe(2000);
    expect(notifyBillsPaymentReceived).toHaveBeenCalledWith({ businessId: B, onlinePaymentId: part.rows[0].id });
    const alloc = await pool.query(
      `SELECT COUNT(*)::int AS n FROM invoice_online_payment_allocations WHERE online_payment_id = $1`,
      [part.rows[0].id],
    );
    expect(alloc.rows[0].n).toBe(2);

    // Picking only the newest bill pays only it, even though an older one is still open.
    const pick = await pool.query<{ id: string }>(
      `INSERT INTO invoice_online_payments (business_id, customer_id, invoice_ids, amount, provider, payment_ref)
       VALUES ($1, $2, $3, 2000, 'razorpay', $4) RETURNING id`,
      [B, C2, [newest], `plink_${randomUUID().slice(0, 12)}`],
    );
    const r2 = await applyInvoiceGatewayPayment({ invoicePaymentId: pick.rows[0].id, businessId: B, amount: 2000, payload: {} });
    expect(r2).toMatchObject({ outcome: 'settled', settled: 2000 });
    expect(await balance(newest)).toBe(0);
    expect(await balance(middle)).toBe(1000);

    // An advance on account lowers "to pay" but is not set against the bills automatically.
    await pool.query(
      `INSERT INTO advance_payments (business_id, customer_id, type, amount, payment_date, status)
       VALUES ($1, $2, 'received', 400, CURRENT_DATE, 'open')`,
      [B, C2],
    );
    const after = await customerDues(B, C2);
    expect(after.billsDue).toBe(1000);
    expect(after.advance).toBe(400);
    expect(after.toPay).toBe(600);
    expect(await balance(middle)).toBe(1000);
  });
});
