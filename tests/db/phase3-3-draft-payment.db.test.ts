/**
 * Phase 3.3: a normal payment is allowed only against a final invoice or final purchase.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
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
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { reverseVouchers } from '@/lib/ledger-reversal';
import { PATCH as patchInvoicePayment } from '@/app/api/invoices/[id]/payments/route';
import { PATCH as finalizeInvoice } from '@/app/api/invoices/[id]/finalize/route';
import { POST as postInvoice } from '@/app/api/invoices/route';
import { PATCH as patchPurchasePayment } from '@/app/api/purchases/[id]/payments/route';
import { PATCH as finalizePurchase } from '@/app/api/purchases/[id]/finalize/route';
import { POST as postPurchase } from '@/app/api/purchases/route';
import { POST as postPayment } from '@/app/api/payments/route';
import { POST as restorePayment } from '@/app/api/payments/restore/route';

d('Phase 3.3 draft/final payment rule (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const OTHER = randomUUID();
  const CUST = randomUUID();
  const SUPP = randomUUID();
  const ITEM = randomUUID();
  const tag = B.slice(0, 8);

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

  const req = (p: string, method: string, body: unknown) =>
    new NextRequest(`http://localhost${p}?user_id=${OTHER}&business_id=${OTHER}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-user-id': OTHER,
        'x-authenticated-user-id': A,
        'x-authenticated-business-id': B,
      },
      body: JSON.stringify(body),
    });

  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json: json as any };
  };

  const spoof = { user_id: OTHER, created_by: OTHER, business_id: OTHER };

  const ledgerCount = async () =>
    Number((await pool.query(`SELECT COUNT(*) AS n FROM ledger_entry_lines WHERE business_id = $1`, [B])).rows[0].n);
  const paymentCount = async () =>
    Number((await pool.query(`SELECT COUNT(*) AS n FROM payments WHERE business_id = $1`, [B])).rows[0].n);

  async function paymentRow(id: string) {
    return (
      await pool.query(
        `SELECT id, amount::float8 AS amount, COALESCE(notes, '') AS notes, reference_type, reference_id::text,
                deleted_at IS NOT NULL AS deleted
           FROM payments WHERE id = $1`,
        [id]
      )
    ).rows[0];
  }

  async function makeInvoice(status: 'draft' | 'final', grand = 1000) {
    const id = randomUUID();
    const no = `INV-${tag}-${id.slice(0, 4)}`;
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, '2026-09-20', $5, 'tax_invoice', '27', $6, 0, 0, 0, 0, $6, 0, $6, 'unpaid', $7)`,
      [id, B, CUST, no, status, grand, BR]
    );
    await pool.query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, hsn_sac, quantity, unit_price, tax_rate, tax_amount, line_total)
       VALUES ($1, $2, 'Consulting', '998314', 1, $3, 0, 0, $3)`,
      [id, ITEM, grand]
    );
    return { id, no, grand };
  }

  async function makePurchase(status: 'draft' | 'final', grand = 800) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1, $2, $3, $4, '2026-09-20', $5, '27', false, true, $6, 0, 0, 0, 0, $6, 0, $6, 'unpaid', $7)`,
      [id, B, SUPP, `PB-${tag}-${id.slice(0, 4)}`, status, grand, BR]
    );
    await pool.query(
      `INSERT INTO purchase_items (purchase_id, item_id, item_name, hsn_sac, quantity, unit_price, taxable_value,
          tax_rate, tax_amount, line_total, line_item_type)
       VALUES ($1, $2, 'Consulting', '998314', 1, $3, $3, 0, 0, $3, 'service')`,
      [id, ITEM, grand]
    );
    return { id, grand };
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `Phase33 ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    const phone = Date.now().toString().slice(-8);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1, $2, 'Clerk', $3, false), ($4, $2, 'Other', $5, true)`,
      [A, B, `91${phone}`, OTHER, `92${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance) VALUES ($1, $2, 'Asha', '27', 0)`,
      [CUST, B]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, current_balance) VALUES ($1, $2, 'Bharat', '27', 0)`,
      [SUPP, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate)
       VALUES ($1, $2, 'Consulting', 'service', 'NOS', 1000, 800, 0)`,
      [ITEM, B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [B]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [B]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  test('draft invoice payment is rejected and writes nothing', async () => {
    const inv = await makeInvoice('draft', 1000);
    const linesBefore = await ledgerCount();
    const paysBefore = await paymentCount();
    const balBefore = Number((await pool.query(`SELECT current_balance FROM customers WHERE id = $1`, [CUST])).rows[0].current_balance);

    const res = await call(
      patchInvoicePayment(req(`/api/invoices/${inv.id}/payments`, 'PATCH', { ...spoof, amount: 200, payment_mode: 'cash' }), {
        params: { id: inv.id },
      })
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('DOCUMENT_NOT_FINAL');
    expect(res.json.error).toMatch(/Finalize this invoice/);

    const created = await call(
      postInvoice(
        req('/api/invoices', 'POST', {
          user_id: OTHER,
          business_id: OTHER,
          id: inv.id,
          status: 'draft',
          document_type: 'tax_invoice',
          invoice_date: '2026-09-20',
          items: [{ item_name: 'Consulting', quantity: 1, unit_price: 1000 }],
          payments: [{ amount: 200, mode: 'cash' }],
        })
      )
    );
    expect(created.status).toBe(409);
    expect(created.json.code).toBe('DOCUMENT_NOT_FINAL');

    expect(await ledgerCount()).toBe(linesBefore);
    expect(await paymentCount()).toBe(paysBefore);
    expect(Number((await pool.query(`SELECT current_balance FROM customers WHERE id = $1`, [CUST])).rows[0].current_balance)).toBe(balBefore);
    const doc = (await pool.query(`SELECT status, paid_amount::float8 AS paid FROM invoices WHERE id = $1`, [inv.id])).rows[0];
    expect(doc).toEqual({ status: 'draft', paid: 0 });
  });

  test('draft purchase payment is rejected and writes nothing', async () => {
    const pur = await makePurchase('draft', 800);
    const linesBefore = await ledgerCount();
    const paysBefore = await paymentCount();
    const billsBefore = Number((await pool.query(`SELECT COUNT(*) AS n FROM purchases WHERE business_id = $1`, [B])).rows[0].n);

    const res = await call(
      patchPurchasePayment(req(`/api/purchases/${pur.id}/payments`, 'PATCH', { ...spoof, amount: 150, payment_mode: 'cash' }), {
        params: { id: pur.id },
      })
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('DOCUMENT_NOT_FINAL');
    expect(res.json.error).toMatch(/Finalize this purchase/);

    const created = await call(
      postPurchase(
        req('/api/purchases', 'POST', {
          status: 'draft',
          paid_amount: 150,
          bill_date: '2026-09-20',
          created_by: OTHER,
          supplier_id: SUPP,
          items: [{ item_name: 'Consulting', quantity: 1, unit_price: 800 }],
        })
      )
    );
    expect(created.status).toBe(409);
    expect(created.json.code).toBe('DOCUMENT_NOT_FINAL');
    expect(Number((await pool.query(`SELECT COUNT(*) AS n FROM purchases WHERE business_id = $1`, [B])).rows[0].n)).toBe(billsBefore);

    expect(await ledgerCount()).toBe(linesBefore);
    expect(await paymentCount()).toBe(paysBefore);
    const doc = (await pool.query(`SELECT status, paid_amount::float8 AS paid FROM purchases WHERE id = $1`, [pur.id])).rows[0];
    expect(doc).toEqual({ status: 'draft', paid: 0 });
  });

  test('generic payment endpoint rejects a draft invoice and a draft purchase', async () => {
    const inv = await makeInvoice('draft');
    const pur = await makePurchase('draft');
    const linesBefore = await ledgerCount();
    const paysBefore = await paymentCount();

    const invPay = await call(
      postPayment(
        req('/api/payments', 'POST', {
          ...spoof,
          type: 'receivable',
          reference_type: 'invoice',
          reference_id: inv.id,
          amount: 100,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    const purPay = await call(
      postPayment(
        req('/api/payments', 'POST', {
          ...spoof,
          type: 'payable',
          reference_type: 'purchase',
          reference_id: pur.id,
          amount: 100,
          payment_mode: 'cash',
          payment_date: '2026-09-20',
        })
      )
    );
    expect(invPay.status).toBe(409);
    expect(invPay.json.code).toBe('DOCUMENT_NOT_FINAL');
    expect(purPay.status).toBe(409);
    expect(purPay.json.code).toBe('DOCUMENT_NOT_FINAL');
    expect(await ledgerCount()).toBe(linesBefore);
    expect(await paymentCount()).toBe(paysBefore);
  });

  test('final invoice payment still posts once, as the session user', async () => {
    const inv = await makeInvoice('final', 1000);
    await pool.query(`UPDATE customers SET current_balance = 1000 WHERE id = $1`, [CUST]);
    const linesBefore = await ledgerCount();

    const res = await call(
      patchInvoicePayment(
        req(`/api/invoices/${inv.id}/payments`, 'PATCH', { ...spoof, amount: 400, payment_mode: 'cash', payment_date: '2026-09-21' }),
        { params: { id: inv.id } }
      )
    );
    expect(res.status).toBe(200);

    const pays = (
      await pool.query(
        `SELECT amount::float8 AS amount, created_by FROM payments WHERE business_id = $1 AND reference_id = $2 AND deleted_at IS NULL`,
        [B, inv.id]
      )
    ).rows;
    expect(pays).toEqual([{ amount: 400, created_by: A }]);
    const doc = (await pool.query(`SELECT paid_amount::float8 AS paid, balance_amount::float8 AS bal FROM invoices WHERE id = $1`, [inv.id])).rows[0];
    expect(doc.paid).toBe(400);
    expect(doc.bal).toBe(600);
    expect(Number((await pool.query(`SELECT current_balance FROM customers WHERE id = $1`, [CUST])).rows[0].current_balance)).toBe(600);

    const lines = (
      await pool.query<{ code: string; dr: number; cr: number }>(
        `SELECT a.account_code AS code, SUM(l.debit)::float8 AS dr, SUM(l.credit)::float8 AS cr
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
           JOIN payments p ON p.id = l.voucher_id
          WHERE l.business_id = $1 AND l.voucher_type = 'payment' AND p.reference_id = $2
          GROUP BY a.account_code`,
        [B, inv.id]
      )
    ).rows;
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '1101', dr: 400, cr: 0 }),
        expect.objectContaining({ code: '1103', dr: 0, cr: 400 }),
      ])
    );
    expect(await ledgerCount()).toBe(linesBefore + 2);
  });

  test('final purchase payment still posts once, as the session user', async () => {
    const pur = await makePurchase('final', 800);
    await pool.query(`UPDATE suppliers SET current_balance = 800 WHERE id = $1`, [SUPP]);
    const linesBefore = await ledgerCount();

    const res = await call(
      patchPurchasePayment(
        req(`/api/purchases/${pur.id}/payments`, 'PATCH', { ...spoof, amount: 300, payment_mode: 'cash', payment_date: '2026-09-21' }),
        { params: { id: pur.id } }
      )
    );
    expect(res.status).toBe(200);

    const pays = (
      await pool.query(
        `SELECT amount::float8 AS amount, created_by FROM payments WHERE business_id = $1 AND reference_id = $2 AND deleted_at IS NULL`,
        [B, pur.id]
      )
    ).rows;
    expect(pays).toEqual([{ amount: 300, created_by: A }]);
    const doc = (await pool.query(`SELECT paid_amount::float8 AS paid FROM purchases WHERE id = $1`, [pur.id])).rows[0];
    expect(doc.paid).toBe(300);
    expect(Number((await pool.query(`SELECT current_balance FROM suppliers WHERE id = $1`, [SUPP])).rows[0].current_balance)).toBe(500);

    const lines = (
      await pool.query<{ code: string; dr: number; cr: number }>(
        `SELECT a.account_code AS code, SUM(l.debit)::float8 AS dr, SUM(l.credit)::float8 AS cr
           FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
           JOIN payments p ON p.id = l.voucher_id
          WHERE l.business_id = $1 AND l.voucher_type = 'payment' AND p.reference_id = $2
          GROUP BY a.account_code`,
        [B, pur.id]
      )
    ).rows;
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '2101', dr: 300, cr: 0 }),
        expect.objectContaining({ code: '1101', dr: 0, cr: 300 }),
      ])
    );
    expect(await ledgerCount()).toBe(linesBefore + 2);
  });

  test('finalizing an unpaid draft posts the document once and creates no payment', async () => {
    const inv = await makeInvoice('draft', 500);
    const pur = await makePurchase('draft', 500);
    await pool.query(`UPDATE customers SET current_balance = 0 WHERE id = $1`, [CUST]);
    await pool.query(`UPDATE suppliers SET current_balance = 0 WHERE id = $1`, [SUPP]);

    const invRes = await call(
      finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', { ...spoof, updated_by: OTHER }), { params: { id: inv.id } })
    );
    expect(invRes.status).toBe(200);
    expect(invRes.json.invoice.status).toBe('final');
    const invDoc = (await pool.query(`SELECT paid_amount::float8 AS paid, balance_amount::float8 AS bal FROM invoices WHERE id = $1`, [inv.id])).rows[0];
    expect(invDoc).toEqual({ paid: 0, bal: 500 });
    expect(Number((await pool.query(`SELECT COUNT(*) AS n FROM payments WHERE reference_id = $1`, [inv.id])).rows[0].n)).toBe(0);
    const invLines = (
      await pool.query<{ dr: string; cr: string; n: string }>(
        `SELECT COALESCE(SUM(debit), 0) AS dr, COALESCE(SUM(credit), 0) AS cr, COUNT(*) AS n
           FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'invoice' AND voucher_id = $2`,
        [B, inv.id]
      )
    ).rows[0];
    expect(Number(invLines.dr)).toBeCloseTo(500, 2);
    expect(Number(invLines.cr)).toBeCloseTo(500, 2);
    expect(Number(invLines.n)).toBeGreaterThan(0);
    expect(Number((await pool.query(`SELECT current_balance FROM customers WHERE id = $1`, [CUST])).rows[0].current_balance)).toBe(500);

    const purRes = await call(
      finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', { user_id: A, updated_by: OTHER }), { params: { id: pur.id } })
    );
    expect(purRes.status).toBe(200);
    expect(purRes.json.purchase.status).toBe('final');
    const purDoc = (await pool.query(`SELECT paid_amount::float8 AS paid, balance_amount::float8 AS bal FROM purchases WHERE id = $1`, [pur.id])).rows[0];
    expect(Number(purDoc.paid)).toBe(0);
    expect(Number(purDoc.bal)).toBeCloseTo(500, 2);
    expect(Number((await pool.query(`SELECT COUNT(*) AS n FROM payments WHERE reference_id = $1`, [pur.id])).rows[0].n)).toBe(0);
    const purLines = (
      await pool.query<{ dr: string; cr: string }>(
        `SELECT COALESCE(SUM(debit), 0) AS dr, COALESCE(SUM(credit), 0) AS cr
           FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'purchase' AND voucher_id = $2`,
        [B, pur.id]
      )
    ).rows[0];
    expect(Number(purLines.dr)).toBeCloseTo(500, 2);
    expect(Number(purLines.cr)).toBeCloseTo(500, 2);
    expect(Number((await pool.query(`SELECT current_balance FROM suppliers WHERE id = $1`, [SUPP])).rows[0].current_balance)).toBe(500);
  });

  test('restore refuses a payment whose ledger is missing or reversed, and does not post a new one', async () => {
    const inv = await makeInvoice('final', 900);
    await pool.query(`UPDATE customers SET current_balance = 900 WHERE id = $1`, [CUST]);
    const paid = await call(
      patchInvoicePayment(req(`/api/invoices/${inv.id}/payments`, 'PATCH', { amount: 200, payment_mode: 'cash' }), {
        params: { id: inv.id },
      })
    );
    expect(paid.status).toBe(200);
    const payId = (await pool.query(`SELECT id FROM payments WHERE reference_id = $1`, [inv.id])).rows[0].id as string;
    const linesAfterPost = await ledgerCount();

    await pool.query(`UPDATE payments SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [payId]);
    const restored = await call(restorePayment(req('/api/payments/restore', 'POST', { ...spoof, id: payId })));
    expect(restored.status).toBe(200);
    expect((await paymentRow(payId)).deleted).toBe(false);
    expect(await ledgerCount()).toBe(linesAfterPost);

    await tx(async (c) => {
      await reverseVouchers(c, {
        businessId: B,
        voucherType: 'payment',
        voucherIds: [payId],
        reason: 'test reverse',
        actorId: A,
      });
    });
    await pool.query(`UPDATE payments SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [payId]);
    const linesAfterReverse = await ledgerCount();
    const refused = await call(restorePayment(req('/api/payments/restore', 'POST', { id: payId, user_id: OTHER })));
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('PAYMENT_RESTORE_ACCOUNTING_UNSAFE');
    expect((await paymentRow(payId)).deleted).toBe(true);
    expect(await ledgerCount()).toBe(linesAfterReverse);

    const bare = randomUUID();
    await pool.query(
      `INSERT INTO payments (id, business_id, branch_id, type, customer_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, created_by, deleted_at)
       VALUES ($1, $2, $3, 'receivable', $4, 'invoice', $5, 50, 'cash', '2026-09-20', 'no-ledger', $6, CURRENT_TIMESTAMP)`,
      [bare, B, BR, CUST, inv.id, A]
    );
    const bareRefuse = await call(restorePayment(req('/api/payments/restore', 'POST', { id: bare })));
    expect(bareRefuse.status).toBe(409);
    expect(bareRefuse.json.code).toBe('PAYMENT_RESTORE_ACCOUNTING_UNSAFE');
    expect((await paymentRow(bare)).deleted).toBe(true);
    expect(await ledgerCount()).toBe(linesAfterReverse);
  });

  test('historical draft payments are left unchanged', async () => {
    const inv = await makeInvoice('draft', 1000);
    const pur = await makePurchase('draft', 800);
    await pool.query(`UPDATE invoices SET paid_amount = 250, balance_amount = 750, payment_status = 'partially_paid' WHERE id = $1`, [inv.id]);
    await pool.query(`UPDATE purchases SET paid_amount = 120, balance_amount = 680, payment_status = 'partially_paid' WHERE id = $1`, [pur.id]);
    const invPay = randomUUID();
    const purPay = randomUUID();
    await pool.query(
      `INSERT INTO payments (id, business_id, branch_id, type, customer_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, created_by)
       VALUES ($1, $2, $3, 'receivable', $4, 'invoice', $5, 250, 'cash', '2026-08-01', 'historical-invoice', $6)`,
      [invPay, B, BR, CUST, inv.id, A]
    );
    await pool.query(
      `INSERT INTO payments (id, business_id, branch_id, type, supplier_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, created_by)
       VALUES ($1, $2, $3, 'payable', $4, 'purchase', $5, 120, 'upi', '2026-08-02', 'historical-purchase', $6)`,
      [purPay, B, BR, SUPP, pur.id, A]
    );
    const beforeInv = await paymentRow(invPay);
    const beforePur = await paymentRow(purPay);
    const beforeDocs = (
      await pool.query(
        `SELECT 'invoice' AS kind, paid_amount::float8 AS paid, balance_amount::float8 AS bal, status FROM invoices WHERE id = $1
         UNION ALL
         SELECT 'purchase', paid_amount::float8, balance_amount::float8, status FROM purchases WHERE id = $2
         ORDER BY kind`,
        [inv.id, pur.id]
      )
    ).rows;

    await call(patchInvoicePayment(req(`/api/invoices/${inv.id}/payments`, 'PATCH', { amount: 10 }), { params: { id: inv.id } }));
    await call(patchPurchasePayment(req(`/api/purchases/${pur.id}/payments`, 'PATCH', { amount: 10 }), { params: { id: pur.id } }));
    await call(
      postPayment(req('/api/payments', 'POST', { type: 'receivable', reference_type: 'invoice', reference_id: inv.id, amount: 10, payment_mode: 'cash' }))
    );
    await call(
      postInvoice(
        req('/api/invoices', 'POST', {
          id: inv.id,
          status: 'draft',
          payments: [{ amount: 999, mode: 'bank' }],
          items: [{ item_name: 'Consulting', quantity: 1, unit_price: 1000 }],
        })
      )
    );

    expect(await paymentRow(invPay)).toEqual(beforeInv);
    expect(await paymentRow(purPay)).toEqual(beforePur);
    const afterDocs = (
      await pool.query(
        `SELECT 'invoice' AS kind, paid_amount::float8 AS paid, balance_amount::float8 AS bal, status FROM invoices WHERE id = $1
         UNION ALL
         SELECT 'purchase', paid_amount::float8, balance_amount::float8, status FROM purchases WHERE id = $2
         ORDER BY kind`,
        [inv.id, pur.id]
      )
    ).rows;
    expect(afterDocs).toEqual(beforeDocs);
    expect(Number((await pool.query(`SELECT COUNT(*) AS n FROM ledger_entry_lines WHERE voucher_id = ANY($1::uuid[])`, [[invPay, purPay]])).rows[0].n)).toBe(0);
  });

  async function docSnapshot(table: 'invoices' | 'purchases', id: string) {
    const row = (
      await pool.query(
        `SELECT status, paid_amount::float8 AS paid, balance_amount::float8 AS bal, payment_status
           FROM ${table} WHERE id = $1`,
        [id]
      )
    ).rows[0];
    return {
      status: row.status as string,
      paid: Number(row.paid),
      bal: Number(row.bal),
      payment_status: row.payment_status as string,
    };
  }

  async function partyBalance(table: 'customers' | 'suppliers', id: string) {
    return Number((await pool.query(`SELECT current_balance::float8 AS b FROM ${table} WHERE id = $1`, [id])).rows[0].b);
  }

  test('draft invoice with paid_amount > 0 is blocked and writes nothing', async () => {
    const inv = await makeInvoice('draft', 1000);
    await pool.query(
      `UPDATE invoices SET paid_amount = 400, balance_amount = 600, payment_status = 'unpaid' WHERE id = $1`,
      [inv.id]
    );
    const before = await docSnapshot('invoices', inv.id);
    const linesBefore = await ledgerCount();
    const balBefore = await partyBalance('customers', CUST);

    const res = await call(
      finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', { updated_by: OTHER }), { params: { id: inv.id } })
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW');
    expect(res.json.error).toMatch(/historical payment information/);
    expect(await docSnapshot('invoices', inv.id)).toEqual(before);
    expect(await ledgerCount()).toBe(linesBefore);
    expect(await partyBalance('customers', CUST)).toBe(balBefore);
  });

  test('draft purchase with paid_amount > 0 is blocked and writes nothing', async () => {
    const pur = await makePurchase('draft', 800);
    await pool.query(
      `UPDATE purchases SET paid_amount = 200, balance_amount = 600, payment_status = 'unpaid' WHERE id = $1`,
      [pur.id]
    );
    const before = await docSnapshot('purchases', pur.id);
    const linesBefore = await ledgerCount();
    const balBefore = await partyBalance('suppliers', SUPP);

    const res = await call(
      finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', { user_id: A }), { params: { id: pur.id } })
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW');
    expect(await docSnapshot('purchases', pur.id)).toEqual(before);
    expect(await ledgerCount()).toBe(linesBefore);
    expect(await partyBalance('suppliers', SUPP)).toBe(balBefore);
  });

  test('draft invoice with an active historical payment row is blocked without changing the row, totals, or ledger', async () => {
    const inv = await makeInvoice('draft', 1000);
    const payId = randomUUID();
    await pool.query(
      `INSERT INTO payments (id, business_id, branch_id, type, customer_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, created_by)
       VALUES ($1, $2, $3, 'receivable', $4, 'invoice', $5, 250, 'cash', '2026-08-01', 'historical-row', $6)`,
      [payId, B, BR, CUST, inv.id, A]
    );
    const beforePay = await paymentRow(payId);
    const before = await docSnapshot('invoices', inv.id);
    const linesBefore = await ledgerCount();

    const res = await call(
      finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', {}), { params: { id: inv.id } })
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW');
    expect(await paymentRow(payId)).toEqual(beforePay);
    expect(await docSnapshot('invoices', inv.id)).toEqual(before);
    expect(await ledgerCount()).toBe(linesBefore);
  });

  test('draft purchase with an active historical payment row is blocked without changing the row, totals, or ledger', async () => {
    const pur = await makePurchase('draft', 800);
    const payId = randomUUID();
    await pool.query(
      `INSERT INTO payments (id, business_id, branch_id, type, supplier_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, created_by)
       VALUES ($1, $2, $3, 'payable', $4, 'purchase', $5, 120, 'upi', '2026-08-02', 'historical-row', $6)`,
      [payId, B, BR, SUPP, pur.id, A]
    );
    const beforePay = await paymentRow(payId);
    const before = await docSnapshot('purchases', pur.id);
    const linesBefore = await ledgerCount();

    const res = await call(
      finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', { user_id: A }), { params: { id: pur.id } })
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW');
    expect(await paymentRow(payId)).toEqual(beforePay);
    expect(await docSnapshot('purchases', pur.id)).toEqual(before);
    expect(await ledgerCount()).toBe(linesBefore);
  });

  test('payment_status that already shows a payment blocks finalization even when paid_amount is zero', async () => {
    const inv = await makeInvoice('draft', 1000);
    const pur = await makePurchase('draft', 800);
    await pool.query(`UPDATE invoices SET payment_status = 'partially_paid' WHERE id = $1`, [inv.id]);
    await pool.query(`UPDATE purchases SET payment_status = 'paid' WHERE id = $1`, [pur.id]);
    const beforeInv = await docSnapshot('invoices', inv.id);
    const beforePur = await docSnapshot('purchases', pur.id);
    const linesBefore = await ledgerCount();

    const invRes = await call(
      finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', {}), { params: { id: inv.id } })
    );
    const purRes = await call(
      finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', { user_id: A }), { params: { id: pur.id } })
    );
    expect(invRes.status).toBe(409);
    expect(purRes.status).toBe(409);
    expect(invRes.json.code).toBe('HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW');
    expect(purRes.json.code).toBe('HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW');
    expect(await docSnapshot('invoices', inv.id)).toEqual(beforeInv);
    expect(await docSnapshot('purchases', pur.id)).toEqual(beforePur);
    expect(await ledgerCount()).toBe(linesBefore);
  });

  test('a soft-deleted payment blocks only when stored totals still show a payment', async () => {
    // payments.deleted_at distinguishes an active row from a historical one.
    // Draft deletion clears paid_amount and payment_status, so a leftover
    // soft-deleted row on an unpaid draft does not block finalization.
    const clear = await makeInvoice('draft', 300);
    const clearPay = randomUUID();
    await pool.query(
      `INSERT INTO payments (id, business_id, branch_id, type, customer_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, created_by, deleted_at)
       VALUES ($1, $2, $3, 'receivable', $4, 'invoice', $5, 100, 'cash', '2026-08-01', 'cleared', $6, CURRENT_TIMESTAMP)`,
      [clearPay, B, BR, CUST, clear.id, A]
    );
    const cleared = await call(
      finalizeInvoice(req(`/api/invoices/${clear.id}/finalize`, 'PATCH', {}), { params: { id: clear.id } })
    );
    expect(cleared.status).toBe(200);
    expect((await docSnapshot('invoices', clear.id)).status).toBe('final');
    expect((await paymentRow(clearPay)).deleted).toBe(true);

    const stuck = await makePurchase('draft', 800);
    const stuckPay = randomUUID();
    await pool.query(
      `UPDATE purchases SET paid_amount = 150, balance_amount = 650, payment_status = 'partially_paid' WHERE id = $1`,
      [stuck.id]
    );
    await pool.query(
      `INSERT INTO payments (id, business_id, branch_id, type, supplier_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, created_by, deleted_at)
       VALUES ($1, $2, $3, 'payable', $4, 'purchase', $5, 150, 'cash', '2026-08-02', 'still-in-totals', $6, CURRENT_TIMESTAMP)`,
      [stuckPay, B, BR, SUPP, stuck.id, A]
    );
    const beforePay = await paymentRow(stuckPay);
    const before = await docSnapshot('purchases', stuck.id);
    const linesBefore = await ledgerCount();
    const blocked = await call(
      finalizePurchase(req(`/api/purchases/${stuck.id}/finalize`, 'PATCH', { user_id: A }), { params: { id: stuck.id } })
    );
    expect(blocked.status).toBe(409);
    expect(blocked.json.code).toBe('HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW');
    expect(await paymentRow(stuckPay)).toEqual(beforePay);
    expect(await docSnapshot('purchases', stuck.id)).toEqual(before);
    expect(await ledgerCount()).toBe(linesBefore);
  });

  test('saving an existing draft invoice as final is blocked when it has historical payment state', async () => {
    const inv = await makeInvoice('draft', 1000);
    await pool.query(
      `UPDATE invoices SET paid_amount = 100, balance_amount = 900, payment_status = 'partially_paid' WHERE id = $1`,
      [inv.id]
    );
    const before = await docSnapshot('invoices', inv.id);
    const linesBefore = await ledgerCount();

    const res = await call(
      postInvoice(
        req('/api/invoices', 'POST', {
          id: inv.id,
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: '2026-09-20',
          branch_id: BR,
          customer_id: CUST,
          items: [{ item_id: ITEM, item_name: 'Consulting', quantity: 1, unit_price: 1000, tax_rate: 0 }],
        })
      )
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW');
    expect(await docSnapshot('invoices', inv.id)).toEqual(before);
    expect(await ledgerCount()).toBe(linesBefore);
  });
});
