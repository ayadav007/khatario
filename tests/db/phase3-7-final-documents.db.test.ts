/**
 * Phase 3.7: final-document immutability, reversal, period locks, tenant and actor identity.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import path from 'path';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
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
jest.mock('@/lib/activity-logger', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
  getClientIP: jest.fn(() => null),
  getUserAgent: jest.fn(() => null),
}));

import { authorize } from '@/lib/authorization';
import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { getCreditNotePolicies } from '@/lib/policies/resources/credit-notes';
import { RULE37_REVERSAL } from '@/lib/gst/rule37';
import { GET as getInvoice } from '@/app/api/invoices/[id]/route';
import { POST as postInvoice } from '@/app/api/invoices/route';
import { PATCH as patchInvoice } from '@/app/api/invoices/[id]/route';
import { PATCH as finalizeInvoice } from '@/app/api/invoices/[id]/finalize/route';
import { PATCH as cancelInvoice } from '@/app/api/invoices/[id]/cancel/route';
import { PATCH as patchInvoicePayment } from '@/app/api/invoices/[id]/payments/route';
import { POST as convertProforma } from '@/app/api/invoices/[id]/convert-to-tax-invoice/route';
import { PATCH as finalizePurchase } from '@/app/api/purchases/[id]/finalize/route';
import { POST as cancelPurchase } from '@/app/api/purchases/[id]/cancel/route';
import { PATCH as patchPurchasePayment } from '@/app/api/purchases/[id]/payments/route';
import { PATCH as cancelCreditNote } from '@/app/api/credit-notes/[id]/cancel/route';
import { GET as listDebitNotes } from '@/app/api/debit-notes/route';
import { PATCH as patchJournal } from '@/app/api/journal-entries/[id]/route';
import { POST as reverseJournalRoute } from '@/app/api/journal-entries/[id]/reverse/route';

d('Phase 3.7 final documents (real DB)', () => {
  jest.setTimeout(180000);

  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const OTHER = randomUUID();
  const CUST = randomUUID();
  const SUPP = randomUUID();
  const ITEM = randomUUID();
  const GOODS = randomUUID();
  const tag = B.slice(0, 8);
  const auth = authorize as jest.Mock;

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

  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json: json as any };
  };

  function req(p: string, method: string, body: unknown, business = B, user = A) {
    return new NextRequest(`http://localhost${p}?user_id=${OTHER}&business_id=${OTHER}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-user-id': OTHER,
        'x-authenticated-user-id': user,
        'x-authenticated-business-id': business,
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
  }

  function reqNoSession(p: string, method: string, body: unknown) {
    return new NextRequest(`http://localhost${p}?user_id=${OTHER}&business_id=${B}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-user-id': OTHER },
      body: JSON.stringify(body),
    });
  }

  async function acc(code: string) {
    const row = (
      await pool.query(`SELECT id FROM accounts WHERE business_id = $1 AND account_code = $2`, [B, code])
    ).rows[0];
    if (!row) throw new Error(`missing account ${code}`);
    return row.id as string;
  }

  async function linesOf(voucherId: string) {
    return (
      await pool.query<{ id: string; debit: string; credit: string }>(
        `SELECT id, debit::text, credit::text FROM ledger_entry_lines WHERE business_id = $1 AND voucher_id = $2 ORDER BY created_at, id`,
        [B, voucherId]
      )
    ).rows;
  }

  async function makeInvoice(status: 'draft' | 'final', grand = 500, date = '2026-09-20') {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,'tax_invoice','27',$7,0,0,0,0,$7,0,$7,'unpaid',$8)`,
      [id, B, CUST, `INV-${tag}-${id.slice(0, 4)}`, date, status, grand, BR]
    );
    await pool.query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, hsn_sac, quantity, unit_price, tax_rate, tax_amount, line_total)
       VALUES ($1,$2,'Consulting','998314',1,$3,0,0,$3)`,
      [id, ITEM, grand]
    );
    return { id, grand };
  }

  async function makePurchase(status: 'draft' | 'final', grand = 400, date = '2026-09-20') {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id)
       VALUES ($1,$2,$3,$4,$5,$6,'27',false,true,$7,0,0,0,0,$7,0,$7,'unpaid',$8)`,
      [id, B, SUPP, `PB-${tag}-${id.slice(0, 4)}`, date, status, grand, BR]
    );
    await pool.query(
      `INSERT INTO purchase_items (purchase_id, item_id, item_name, hsn_sac, quantity, unit_price, taxable_value,
          tax_rate, tax_amount, line_total, line_item_type)
       VALUES ($1,$2,'Consulting','998314',1,$3,$3,0,0,$3,'service')`,
      [id, ITEM, grand]
    );
    return { id, grand };
  }

  async function makeProforma(opts?: { status?: string; lifecycle?: string }) {
    const id = randomUUID();
    const grand = 200;
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, estimate_status, proforma_lifecycle_status)
       VALUES ($1,$2,$3,$4,'2026-09-20',$5,'proforma_invoice','27',$6,0,0,0,0,$6,0,$6,'unpaid',$7,'draft',$8)`,
      [id, B, CUST, `PI-${tag}-${id.slice(0, 4)}`, opts?.status ?? 'draft', grand, BR, opts?.lifecycle ?? 'created']
    );
    await pool.query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, hsn_sac, quantity, unit_price, tax_rate, tax_amount, line_total)
       VALUES ($1,$2,'Widget','847130',2,100,0,0,200)`,
      [id, GOODS]
    );
    return { id, grand };
  }

  async function postPair(voucherType: string, voucherId: string, amount: number, date = '2026-09-20', reference?: string) {
    const dr = await acc('4101');
    const cr = await acc('1103');
    await pool.query(
      `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit, narration, reference_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,'orig',$8), ($1,$2,$3,$4,$9,$6,0,$7,'orig',$8)`,
      [B, BR, voucherId, voucherType, dr, date, amount, reference ?? null, cr]
    );
  }

  async function makeCreditNote(amount = 100, date = '2026-09-20') {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO credit_notes (id, business_id, branch_id, customer_id, credit_note_number, credit_note_date,
          subtotal, grand_total, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'active',$8)`,
      [id, B, BR, CUST, `CN-${tag}-${id.slice(0, 4)}`, date, amount, A]
    );
    await pool.query(
      `INSERT INTO credit_note_items (credit_note_id, item_id, description, qty, unit_price, tax_rate, tax_amount, line_total)
       VALUES ($1,$2,'Widget',2,50,0,0,100)`,
      [id, GOODS]
    );
    await postPair('credit_note', id, amount, date);
    return { id, amount };
  }

  async function makeDebitNote(amount = 80) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO debit_notes (id, business_id, branch_id, customer_id, debit_note_number, debit_note_date,
          subtotal, grand_total, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'2026-09-20',$6,$6,'active',$7)`,
      [id, B, BR, CUST, `DN-${tag}-${id.slice(0, 4)}`, amount, A]
    );
    await postPair('debit_note', id, amount);
    return { id, amount };
  }

  async function makeJournal(amount = 100, date = '2026-09-20') {
    const voucherId = randomUUID();
    const exp = await acc('5201');
    const cash = await acc('1101');
    await pool.query(
      `INSERT INTO journal_entries (business_id, voucher_id, voucher_number, entry_date, narration, branch_id, created_by)
       VALUES ($1,$2,$3,$4,'Phase 3.7',$5,$6)`,
      [B, voucherId, `JV-${tag}-${voucherId.slice(0, 4)}`, date, BR, A]
    );
    await pool.query(
      `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit, narration)
       VALUES ($1,$2,$3,'journal',$4,$5,$6,0,'Tea'), ($1,$2,$3,'journal',$7,$5,0,$6,'Cash')`,
      [B, BR, voucherId, exp, date, amount, cash]
    );
    return { voucherId, amount };
  }

  async function stockQty() {
    return Number(
      (await pool.query(`SELECT quantity::float8 AS q FROM branch_item_stock WHERE business_id = $1 AND item_id = $2`, [B, GOODS])).rows[0].q
    );
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_converted_invoice_id
        ON invoices (converted_invoice_id) WHERE converted_invoice_id IS NOT NULL;
    `);
    const gstA = `27AABCU${tag.slice(0, 4).toUpperCase()}C1Z5`;
    const gstB = `29AABCU${tag.slice(0, 4).toUpperCase()}D1Z5`;
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1,$2,$3,'27','regular'), ($4,$5,$6,'29','regular')`,
      [B, `Phase37 ${tag}`, gstA, B2, `Phase37b ${tag}`, gstB]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1,$2,'Main','27',true,true,true)`,
      [BR, B]
    );
    const phone = Date.now().toString().slice(-9);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1,$2,'Clerk',$3,true), ($4,$2,'Other',$5,false)`,
      [A, B, `9${phone}`, OTHER, `8${phone}`]
    );
    await pool.query(`UPDATE users SET auth_session_version = 1 WHERE id = $1`, [A]).catch(() => {});
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B2]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B2]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance, phone) VALUES ($1,$2,'Asha','27',0,$3)`,
      [CUST, B, `9${phone}`]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, current_balance) VALUES ($1,$2,'Bharat','27',0)`,
      [SUPP, B]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1,$2,'Consulting','service','NOS',500,400,0,'998314'),
              ($3,$2,'Widget','goods','NOS',100,40,0,'847130')`,
      [ITEM, B, GOODS]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity) VALUES ($1,$2,$3,10)`,
      [B, BR, GOODS]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', A, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, B2]]);
        });
      });
      await pool.query(`DELETE FROM ledger_entry_deletions WHERE business_id = ANY($1::uuid[])`, [[B, B2]]).catch(() => {});
    } finally {
      await closePool();
    }
  });

  beforeEach(async () => {
    auth.mockClear();
    await pool.query(`UPDATE customers SET current_balance = 0 WHERE id = $1`, [CUST]);
    await pool.query(`UPDATE suppliers SET current_balance = 0 WHERE id = $1`, [SUPP]);
    await pool.query(`UPDATE branch_item_stock SET quantity = 10 WHERE business_id = $1 AND item_id = $2`, [B, GOODS]);
    await pool.query(`DELETE FROM period_locks WHERE business_id = $1`, [B]);
    await pool.query(`DELETE FROM gst_filings WHERE business_id = $1`, [B]);
  });

  test('1 draft invoice has no ledger and no stock movement', async () => {
    const inv = await makeInvoice('draft');
    await pool.query(`UPDATE invoice_items SET item_id = $2 WHERE invoice_id = $1`, [inv.id, GOODS]);
    expect(await linesOf(inv.id)).toHaveLength(0);
    expect(
      Number((await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE reference_id = $1`, [inv.id])).rows[0].n)
    ).toBe(0);
    expect(await stockQty()).toBe(10);
  });

  test('2 draft invoice payment is rejected', async () => {
    const inv = await makeInvoice('draft');
    const res = await call(
      patchInvoicePayment(req(`/api/invoices/${inv.id}/payments`, 'PATCH', { user_id: OTHER, amount: 100, payment_mode: 'cash' }), {
        params: { id: inv.id },
      })
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('DOCUMENT_NOT_FINAL');
    expect(await linesOf(inv.id)).toHaveLength(0);
    expect(Number((await pool.query(`SELECT paid_amount::float8 AS p FROM invoices WHERE id = $1`, [inv.id])).rows[0].p)).toBe(0);
  });

  test('3 finalization posts once', async () => {
    const inv = await makeInvoice('draft', 500);
    const first = await call(finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', { user_id: OTHER, updated_by: OTHER }), { params: { id: inv.id } }));
    expect(first.status).toBe(200);
    expect(first.json.invoice.status).toBe('final');
    const posted = await linesOf(inv.id);
    expect(posted.length).toBeGreaterThan(0);
    const second = await call(finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', { user_id: OTHER }), { params: { id: inv.id } }));
    expect(second.status).toBe(200);
    expect(await linesOf(inv.id)).toEqual(posted);
  });

  test('4 final invoice cannot be edited directly', async () => {
    const inv = await makeInvoice('draft', 500);
    await call(finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', {}), { params: { id: inv.id } }));
    const before = await linesOf(inv.id);
    const res = await call(
      postInvoice(
        req('/api/invoices', 'POST', {
          id: inv.id,
          status: 'final',
          document_type: 'tax_invoice',
          invoice_date: '2026-09-20',
          customer_id: CUST,
          branch_id: BR,
          items: [{ item_id: ITEM, item_name: 'Consulting', quantity: 1, unit_price: 1, tax_rate: 0 }],
        })
      )
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('INVOICE_POSTED_IMMUTABLE');
    expect(await linesOf(inv.id)).toEqual(before);
    expect(Number((await pool.query(`SELECT grand_total::float8 AS g FROM invoices WHERE id = $1`, [inv.id])).rows[0].g)).toBe(500);
  });

  test('5 cancellation creates a reversal and 6 original ledger lines stay unchanged', async () => {
    const inv = await makeInvoice('draft', 500);
    await call(finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', {}), { params: { id: inv.id } }));
    const before = await linesOf(inv.id);
    const res = await call(cancelInvoice(req(`/api/invoices/${inv.id}/cancel`, 'PATCH', { reason: 'Wrong party', cancelled_by: OTHER }), { params: { id: inv.id } }));
    expect(res.status).toBe(200);
    expect(res.json.invoice.status).toBe('cancelled');
    const after = await linesOf(inv.id);
    expect(after.length).toBe(before.length * 2);
    for (const row of before) {
      expect(after.find((l) => l.id === row.id)).toEqual(row);
    }
    const links = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_reversals WHERE business_id = $1 AND voucher_id = $2`, [B, inv.id])).rows[0].n
    );
    expect(links).toBe(before.length);
  });

  test('7 a second invoice cancellation is rejected', async () => {
    const inv = await makeInvoice('draft', 500);
    await call(finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', {}), { params: { id: inv.id } }));
    await call(cancelInvoice(req(`/api/invoices/${inv.id}/cancel`, 'PATCH', { reason: 'Once' }), { params: { id: inv.id } }));
    const after = await linesOf(inv.id);
    const again = await call(cancelInvoice(req(`/api/invoices/${inv.id}/cancel`, 'PATCH', { reason: 'Twice' }), { params: { id: inv.id } }));
    expect(again.status).toBe(409);
    expect(await linesOf(inv.id)).toEqual(after);
  });

  test('8 draft purchase payment is rejected', async () => {
    const pur = await makePurchase('draft');
    const res = await call(
      patchPurchasePayment(req(`/api/purchases/${pur.id}/payments`, 'PATCH', { user_id: OTHER, amount: 50, payment_mode: 'cash' }), {
        params: { id: pur.id },
      })
    );
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('DOCUMENT_NOT_FINAL');
    expect(await linesOf(pur.id)).toHaveLength(0);
  });

  test('9 final purchase posts once and the supplier balance matches the bill', async () => {
    const pur = await makePurchase('draft', 400);
    const first = await call(finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', { user_id: OTHER, updated_by: OTHER }), { params: { id: pur.id } }));
    expect(first.status).toBe(200);
    expect(first.json.purchase.status).toBe('final');
    const posted = await linesOf(pur.id);
    expect(posted.length).toBeGreaterThan(0);
    expect(Number((await pool.query(`SELECT current_balance::float8 AS b FROM suppliers WHERE id = $1`, [SUPP])).rows[0].b)).toBe(400);
    const second = await call(finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', { user_id: A }), { params: { id: pur.id } }));
    expect(second.status).toBe(200);
    expect(await linesOf(pur.id)).toEqual(posted);
    expect(Number((await pool.query(`SELECT current_balance::float8 AS b FROM suppliers WHERE id = $1`, [SUPP])).rows[0].b)).toBe(400);
    expect(auth).toHaveBeenCalledWith(A, 'purchases', 'update', expect.objectContaining({ businessId: B }));
  });

  test('10 final purchase cancellation reverses accounting and restores the supplier', async () => {
    const pur = await makePurchase('draft', 400);
    await call(finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', {}), { params: { id: pur.id } }));
    const before = await linesOf(pur.id);
    const res = await call(cancelPurchase(req(`/api/purchases/${pur.id}/cancel`, 'POST', { reason: 'Wrong bill', cancelled_by: OTHER }), { params: { id: pur.id } }));
    expect(res.status).toBe(200);
    const after = await linesOf(pur.id);
    expect(after.length).toBe(before.length * 2);
    for (const row of before) expect(after.find((l) => l.id === row.id)).toEqual(row);
    expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [pur.id])).rows[0].status).toBe('cancelled');
    expect(Number((await pool.query(`SELECT current_balance::float8 AS b FROM suppliers WHERE id = $1`, [SUPP])).rows[0].b)).toBe(0);
  });

  test('11 cancelled TDS stays on the bill as an auditable cancelled row', async () => {
    const pur = await makePurchase('draft', 400);
    await call(finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', {}), { params: { id: pur.id } }));
    const tdsId = randomUUID();
    await pool.query(
      `INSERT INTO tds_transactions (id, business_id, supplier_id, purchase_id, section_code, payment_amount, tds_rate,
          tds_amount, net_payment_amount, transaction_date, financial_year, quarter, status, created_by)
       VALUES ($1,$2,$3,$4,'194C',400,1,4,396,'2026-09-20','2026-2027','Q2','active',$5)`,
      [tdsId, B, SUPP, pur.id, A]
    );
    await pool.query(`UPDATE purchases SET tds_deducted = 4 WHERE id = $1`, [pur.id]);
    const res = await call(cancelPurchase(req(`/api/purchases/${pur.id}/cancel`, 'POST', { reason: 'TDS audit' }), { params: { id: pur.id } }));
    expect(res.status).toBe(200);
    const row = (
      await pool.query(`SELECT status, cancelled_by FROM tds_transactions WHERE id = $1`, [tdsId])
    ).rows[0];
    expect(row.status).toBe('cancelled');
    expect(row.cancelled_by).toBe(A);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM tds_transactions WHERE id = $1`, [tdsId])).rows[0].n)).toBe(1);
  });

  test('12 a Rule 37 reversal stays linked when the bill is cancelled', async () => {
    const pur = await makePurchase('draft', 400);
    await call(finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', {}), { params: { id: pur.id } }));
    const voucherId = randomUUID();
    const dr = await acc('2150');
    const cr = await acc('2101');
    await pool.query(
      `INSERT INTO ledger_entry_lines (business_id, branch_id, voucher_id, voucher_type, account_id, entry_date, debit, credit, narration, reference_number)
       VALUES ($1,$2,$3,$4,$5,'2026-09-20',18,0,'r37',$7), ($1,$2,$3,$4,$6,'2026-09-20',0,18,'r37',$7)`,
      [B, BR, voucherId, RULE37_REVERSAL, dr, cr, `RULE37|${pur.id}`]
    );
    const original = (await linesOf(voucherId)).map((l) => l.id);
    const res = await call(cancelPurchase(req(`/api/purchases/${pur.id}/cancel`, 'POST', { reason: 'Rule 37' }), { params: { id: pur.id } }));
    expect(res.status).toBe(200);
    const still = (
      await pool.query(`SELECT id FROM ledger_entry_lines WHERE id = ANY($1::uuid[])`, [original])
    ).rows.map((r) => r.id);
    expect(still.sort()).toEqual([...original].sort());
    const links = (
      await pool.query(`SELECT original_line_id FROM ledger_entry_reversals WHERE voucher_id = $1`, [voucherId])
    ).rows.map((r) => r.original_line_id);
    expect(links.sort()).toEqual([...original].sort());
  });

  test('13 a paid final purchase cannot be cancelled or refunded', async () => {
    const pur = await makePurchase('draft', 400);
    await call(finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', {}), { params: { id: pur.id } }));
    const pay = await call(
      patchPurchasePayment(req(`/api/purchases/${pur.id}/payments`, 'PATCH', { amount: 100, payment_mode: 'cash', user_id: OTHER }), {
        params: { id: pur.id },
      })
    );
    expect(pay.status).toBe(200);
    const before = await linesOf(pur.id);
    const res = await call(cancelPurchase(req(`/api/purchases/${pur.id}/cancel`, 'POST', { reason: 'Please refund' }), { params: { id: pur.id } }));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('PURCHASE_HAS_PAYMENTS');
    expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [pur.id])).rows[0].status).toBe('final');
    expect(await linesOf(pur.id)).toEqual(before);
    expect(
      Number((await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE reference_id = $1 AND deleted_at IS NULL`, [pur.id])).rows[0].n)
    ).toBe(1);
  });

  test('14 a posted credit note ledger cannot be edited', async () => {
    const cn = await makeCreditNote();
    const line = (await linesOf(cn.id))[0];
    await expect(pool.query(`UPDATE ledger_entry_lines SET debit = debit + 1 WHERE id = $1`, [line.id])).rejects.toThrow();
    expect((await linesOf(cn.id)).find((l) => l.id === line.id)?.debit).toBe(line.debit);
    expect(Number((await pool.query(`SELECT grand_total::float8 AS g FROM credit_notes WHERE id = $1`, [cn.id])).rows[0].g)).toBe(cn.amount);
  });

  test('15 credit-note cancellation is authorized as the session user', async () => {
    expect(getCreditNotePolicies().some((p) => p.action === 'cancel' && p.requiresPermission === 'credit_notes.delete')).toBe(true);
    const cn = await makeCreditNote();
    const res = await call(
      cancelCreditNote(req(`/api/credit-notes/${cn.id}/cancel`, 'PATCH', { reason: 'Returned', cancelled_by: OTHER, user_id: OTHER }), {
        params: { id: cn.id },
      })
    );
    expect(res.status).toBe(200);
    expect(auth).toHaveBeenCalledWith(
      A,
      'credit_notes',
      'cancel',
      expect.objectContaining({ businessId: B, resourceId: cn.id })
    );
    expect((await pool.query(`SELECT cancelled_by FROM credit_notes WHERE id = $1`, [cn.id])).rows[0].cancelled_by).toBe(A);
    const actors = (
      await pool.query(`SELECT DISTINCT created_by FROM ledger_entry_reversals WHERE voucher_id = $1`, [cn.id])
    ).rows.map((r) => r.created_by);
    expect(actors).toEqual([A]);
  });

  test('16 concurrent credit-note cancellation is row-locked and reverses once', async () => {
    const cn = await makeCreditNote();
    const [a, b] = await Promise.all([
      call(cancelCreditNote(req(`/api/credit-notes/${cn.id}/cancel`, 'PATCH', { reason: 'A' }), { params: { id: cn.id } })),
      call(cancelCreditNote(req(`/api/credit-notes/${cn.id}/cancel`, 'PATCH', { reason: 'B' }), { params: { id: cn.id } })),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect((await pool.query(`SELECT status FROM credit_notes WHERE id = $1`, [cn.id])).rows[0].status).toBe('cancelled');
    const originals = 2;
    expect(await linesOf(cn.id)).toHaveLength(originals * 2);
    expect(
      Number((await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE reference_type = 'credit_note_cancel' AND reference_id = $1`, [cn.id])).rows[0].n)
    ).toBe(1);
    expect(await stockQty()).toBe(8);
  });

  test('17 a second credit-note cancellation is rejected', async () => {
    const cn = await makeCreditNote();
    await call(cancelCreditNote(req(`/api/credit-notes/${cn.id}/cancel`, 'PATCH', { reason: 'Once' }), { params: { id: cn.id } }));
    const after = await linesOf(cn.id);
    const again = await call(cancelCreditNote(req(`/api/credit-notes/${cn.id}/cancel`, 'PATCH', { reason: 'Twice' }), { params: { id: cn.id } }));
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('CREDIT_NOTE_ALREADY_CANCELLED');
    expect(await linesOf(cn.id)).toEqual(after);
  });

  test('18 a credit note cannot be cancelled from another business', async () => {
    const cn = await makeCreditNote();
    const res = await call(
      cancelCreditNote(req(`/api/credit-notes/${cn.id}/cancel`, 'PATCH', { reason: 'Cross', business_id: B }, B2, A), { params: { id: cn.id } })
    );
    expect(res.status).toBe(404);
    expect((await pool.query(`SELECT status FROM credit_notes WHERE id = $1`, [cn.id])).rows[0].status).toBe('active');
    expect(await linesOf(cn.id)).toHaveLength(2);
  });

  test('19 a final debit note cannot be directly modified', async () => {
    const note = await makeDebitNote();
    const routes = await import('@/app/api/debit-notes/route');
    expect((routes as { PATCH?: unknown }).PATCH).toBeUndefined();
    expect((routes as { PUT?: unknown }).PUT).toBeUndefined();
    expect((routes as { DELETE?: unknown }).DELETE).toBeUndefined();
    const line = (await linesOf(note.id))[0];
    await expect(pool.query(`UPDATE ledger_entry_lines SET debit = debit + 5 WHERE id = $1`, [line.id])).rejects.toThrow();
    expect(Number((await pool.query(`SELECT grand_total::float8 AS g FROM debit_notes WHERE id = $1`, [note.id])).rows[0].g)).toBe(note.amount);
    expect((await pool.query(`SELECT status FROM debit_notes WHERE id = $1`, [note.id])).rows[0].status).toBe('active');
  });

  test('20 debit notes have no cancellation route and posted lines cannot be deleted', async () => {
    expect(existsSync(path.join(process.cwd(), 'app/api/debit-notes/[id]/cancel/route.ts'))).toBe(false);
    const note = await makeDebitNote();
    const before = await linesOf(note.id);
    await expect(pool.query(`DELETE FROM ledger_entry_lines WHERE voucher_id = $1`, [note.id])).rejects.toThrow();
    expect(await linesOf(note.id)).toEqual(before);
    expect((await pool.query(`SELECT status FROM debit_notes WHERE id = $1`, [note.id])).rows[0].status).toBe('active');
  });

  test('21 a debit note from another business is not listed', async () => {
    const note = await makeDebitNote();
    const own = await call(listDebitNotes(req('/api/debit-notes?business_id=' + B2, 'GET', null)));
    expect(own.status).toBe(200);
    expect((own.json.debitNotes as Array<{ id: string }>).some((n) => n.id === note.id)).toBe(true);
    const other = await call(listDebitNotes(req('/api/debit-notes?business_id=' + B, 'GET', null, B2, A)));
    expect(other.status).toBe(200);
    const rows = (other.json.debitNotes || []) as Array<{ id: string }>;
    expect(rows.some((n) => n.id === note.id)).toBe(false);
  });

  test('22 reversing a journal leaves the original lines unchanged', async () => {
    const j = await makeJournal();
    const before = await linesOf(j.voucherId);
    const res = await call(reverseJournalRoute(req(`/api/journal-entries/${j.voucherId}/reverse`, 'POST', { reason: 'Wrong head', user_id: OTHER }), { params: { id: j.voucherId } }));
    expect(res.status).toBe(200);
    const after = await linesOf(j.voucherId);
    expect(after.length).toBe(4);
    for (const row of before) expect(after.find((l) => l.id === row.id)).toEqual(row);
    expect((await pool.query(`SELECT deleted_at FROM journal_entries WHERE voucher_id = $1`, [j.voucherId])).rows[0].deleted_at).toBeNull();
  });

  test('23 journal reversal creates linked opposite lines', async () => {
    const j = await makeJournal(60);
    await call(reverseJournalRoute(req(`/api/journal-entries/${j.voucherId}/reverse`, 'POST', { reason: 'Opposite' }), { params: { id: j.voucherId } }));
    const rows = (
      await pool.query<{ debit: number; credit: number; o_dr: number; o_cr: number; created_by: string }>(
        `SELECT r.debit::float8 AS debit, r.credit::float8 AS credit, o.debit::float8 AS o_dr, o.credit::float8 AS o_cr, ler.created_by
           FROM ledger_entry_reversals ler
           JOIN ledger_entry_lines o ON o.id = ler.original_line_id
           JOIN ledger_entry_lines r ON r.id = ler.reversal_line_id
          WHERE ler.voucher_id = $1`,
        [j.voucherId]
      )
    ).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.debit).toBe(row.o_cr);
      expect(row.credit).toBe(row.o_dr);
      expect(row.created_by).toBe(A);
    }
  });

  test('24 a second journal reversal is rejected', async () => {
    const j = await makeJournal();
    await call(reverseJournalRoute(req(`/api/journal-entries/${j.voucherId}/reverse`, 'POST', { reason: 'Once' }), { params: { id: j.voucherId } }));
    const after = await linesOf(j.voucherId);
    const again = await call(reverseJournalRoute(req(`/api/journal-entries/${j.voucherId}/reverse`, 'POST', { reason: 'Twice' }), { params: { id: j.voucherId } }));
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('JOURNAL_ALREADY_REVERSED');
    expect(await linesOf(j.voucherId)).toEqual(after);
  });

  test('25 a journal cannot be reversed from another business', async () => {
    const j = await makeJournal();
    const res = await call(
      reverseJournalRoute(req(`/api/journal-entries/${j.voucherId}/reverse`, 'POST', { reason: 'Cross', business_id: B }, B2, A), {
        params: { id: j.voucherId },
      })
    );
    expect(res.status).toBe(404);
    expect(await linesOf(j.voucherId)).toHaveLength(2);
  });

  test('26 a proforma has no ledger', async () => {
    const doc = await makeProforma();
    const res = await call(finalizeInvoice(req(`/api/invoices/${doc.id}/finalize`, 'PATCH', { user_id: OTHER }), { params: { id: doc.id } }));
    expect(res.status).toBe(200);
    expect(res.json.invoice.document_type).toBe('proforma_invoice');
    expect(await linesOf(doc.id)).toHaveLength(0);
  });

  test('27 a proforma does not post final stock', async () => {
    const doc = await makeProforma();
    await call(finalizeInvoice(req(`/api/invoices/${doc.id}/finalize`, 'PATCH', {}), { params: { id: doc.id } }));
    expect(await stockQty()).toBe(10);
    expect(
      Number((await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE reference_id = $1`, [doc.id])).rows[0].n)
    ).toBe(0);
  });

  test('28 conversion creates exactly one final invoice and ignores a client converted flag', async () => {
    const doc = await makeProforma();
    const flagged = await call(
      patchInvoice(req(`/api/invoices/${doc.id}`, 'PATCH', { estimate_status: 'converted', business_id: B2, created_by: OTHER }), {
        params: { id: doc.id },
      })
    );
    expect(flagged.status).toBe(409);
    expect(flagged.json.code).toBe('ESTIMATE_CONVERSION_REQUIRED');
    expect((await pool.query(`SELECT converted_invoice_id FROM invoices WHERE id = $1`, [doc.id])).rows[0].converted_invoice_id).toBeNull();
    const res = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { business_id: B2, created_by: OTHER, status: 'draft' }), { params: { id: doc.id } }));
    expect(res.status).toBe(200);
    const child = res.json.invoice_id as string;
    expect(child).toBeTruthy();
    const kids = await pool.query(`SELECT id, status, document_type, business_id, created_by FROM invoices WHERE id = $1`, [child]);
    expect(kids.rows[0]).toMatchObject({ status: 'final', document_type: 'tax_invoice', business_id: B, created_by: A });
    expect(
      Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE id = $1`, [child])).rows[0].n)
    ).toBe(1);
    expect((await pool.query(`SELECT converted_invoice_id FROM invoices WHERE id = $1`, [doc.id])).rows[0].converted_invoice_id).toBe(child);
    expect((await linesOf(child)).length).toBeGreaterThan(0);
    expect(await linesOf(doc.id)).toHaveLength(0);
    const again = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', {}), { params: { id: doc.id } }));
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('PROFORMA_ALREADY_CONVERTED');
  });

  test('29 concurrent conversion creates one invoice', async () => {
    const doc = await makeProforma();
    const [a, b] = await Promise.all([
      call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', {}), { params: { id: doc.id } })),
      call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', {}), { params: { id: doc.id } })),
    ]);
    const ok = [a, b].filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect([a, b].some((r) => r.status === 409)).toBe(true);
    const row = (await pool.query(`SELECT converted_invoice_id FROM invoices WHERE id = $1`, [doc.id])).rows[0];
    expect(row.converted_invoice_id).toBeTruthy();
    expect(
      Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE id = $1`, [row.converted_invoice_id])).rows[0].n)
    ).toBe(1);
    expect(await stockQty()).toBe(8);
  });

  test('30 a cancelled proforma cannot convert', async () => {
    const doc = await makeProforma({ status: 'cancelled', lifecycle: 'cancelled' });
    const res = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { estimate_status: 'converted' }), { params: { id: doc.id } }));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('PROFORMA_CANCELLED');
    expect((await pool.query(`SELECT converted_invoice_id FROM invoices WHERE id = $1`, [doc.id])).rows[0].converted_invoice_id).toBeNull();
    expect(await stockQty()).toBe(10);
    expect(await linesOf(doc.id)).toHaveLength(0);
  });

  test('31 a locked accounting period blocks cancellation before any reversal', async () => {
    const today = (await pool.query(`SELECT CURRENT_DATE::text AS d`)).rows[0].d as string;
    const inv = await makeInvoice('draft', 500, today);
    const pur = await makePurchase('draft', 400, today);
    const cn = await makeCreditNote(100, today);
    const j = await makeJournal(25, today);
    expect((await call(finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', {}), { params: { id: inv.id } }))).status).toBe(200);
    expect((await call(finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', {}), { params: { id: pur.id } }))).status).toBe(200);
    await pool.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, NULL, '2026-27', CURRENT_DATE, CURRENT_DATE, true, $2)`,
      [B, A]
    );
    const invRes = await call(cancelInvoice(req(`/api/invoices/${inv.id}/cancel`, 'PATCH', { reason: 'Locked' }), { params: { id: inv.id } }));
    const purRes = await call(cancelPurchase(req(`/api/purchases/${pur.id}/cancel`, 'POST', { reason: 'Locked' }), { params: { id: pur.id } }));
    const cnRes = await call(cancelCreditNote(req(`/api/credit-notes/${cn.id}/cancel`, 'PATCH', { reason: 'Locked' }), { params: { id: cn.id } }));
    const jRes = await call(reverseJournalRoute(req(`/api/journal-entries/${j.voucherId}/reverse`, 'POST', { reason: 'Locked' }), { params: { id: j.voucherId } }));
    expect(invRes.status).toBe(403);
    expect(invRes.json.code).toBe('PERIOD_LOCKED');
    expect(purRes.status).toBe(403);
    expect(purRes.json.code).toBe('PERIOD_LOCKED');
    expect(cnRes.status).toBe(403);
    expect(cnRes.json.code).toBe('PERIOD_LOCKED');
    expect(jRes.status).toBe(403);
    expect(jRes.json.code).toBe('PERIOD_LOCKED');
    expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [inv.id])).rows[0].status).toBe('final');
    expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [pur.id])).rows[0].status).toBe('final');
    expect((await pool.query(`SELECT status FROM credit_notes WHERE id = $1`, [cn.id])).rows[0].status).toBe('active');
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_reversals WHERE voucher_id = ANY($1::uuid[])`, [[inv.id, pur.id, cn.id, j.voucherId]])).rows[0].n)).toBe(0);
  });

  test('32 a filed GST period blocks cancellation before any reversal', async () => {
    const today = (await pool.query(`SELECT CURRENT_DATE::text AS d, to_char(CURRENT_DATE, 'YYYY-MM') AS p`)).rows[0] as { d: string; p: string };
    const inv = await makeInvoice('draft', 500, today.d);
    const cn = await makeCreditNote(100, today.d);
    expect((await call(finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', {}), { params: { id: inv.id } }))).status).toBe(200);
    await pool.query(
      `INSERT INTO gst_filings (business_id, branch_id, gst_period, status, filed_at) VALUES ($1, NULL, $2, 'filed', NOW())`,
      [B, today.p]
    );
    const invRes = await call(cancelInvoice(req(`/api/invoices/${inv.id}/cancel`, 'PATCH', { reason: 'Filed' }), { params: { id: inv.id } }));
    const cnRes = await call(cancelCreditNote(req(`/api/credit-notes/${cn.id}/cancel`, 'PATCH', { reason: 'Filed' }), { params: { id: cn.id } }));
    expect(invRes.status).toBe(403);
    expect(invRes.json.code).toBe('GST_PERIOD_FILED');
    expect(cnRes.status).toBe(403);
    expect(cnRes.json.code).toBe('GST_PERIOD_FILED');
    expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [inv.id])).rows[0].status).toBe('final');
    expect((await pool.query(`SELECT status FROM credit_notes WHERE id = $1`, [cn.id])).rows[0].status).toBe('active');
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_reversals WHERE voucher_id = ANY($1::uuid[])`, [[inv.id, cn.id]])).rows[0].n)).toBe(0);
  });

  test('33 client-supplied identity cannot override the session', async () => {
    const draft = await makeInvoice('draft', 220);
    const unsigned = await call(
      finalizeInvoice(reqNoSession(`/api/invoices/${draft.id}/finalize`, 'PATCH', { user_id: OTHER, updated_by: OTHER, created_by: OTHER }), {
        params: { id: draft.id },
      })
    );
    expect(unsigned.status).toBe(401);
    expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [draft.id])).rows[0].status).toBe('draft');

    const cn = await makeCreditNote();
    const cancelled = await call(
      cancelCreditNote(req(`/api/credit-notes/${cn.id}/cancel`, 'PATCH', { reason: 'Identity', cancelled_by: OTHER, user_id: OTHER }), {
        params: { id: cn.id },
      })
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.json.creditNote.cancelled_by).toBe(A);

    const j = await makeJournal();
    const patched = await call(
      patchJournal(req(`/api/journal-entries/${j.voucherId}`, 'PATCH', { narration: 'Session actor', updated_by: OTHER, user_id: OTHER }), {
        params: { id: j.voucherId },
      })
    );
    expect(patched.status).toBe(200);
    expect((await pool.query(`SELECT updated_by FROM journal_entries WHERE voucher_id = $1`, [j.voucherId])).rows[0].updated_by).toBe(A);
  });

  test('34 another business cannot read or mutate these documents', async () => {
    const inv = await makeInvoice('draft', 500);
    const pur = await makePurchase('draft', 400);
    const doc = await makeProforma();
    const read = await call(getInvoice(req(`/api/invoices/${inv.id}?business_id=${B}`, 'GET', null, B2, A), { params: { id: inv.id } }));
    expect(read.status).toBe(404);
    const fin = await call(finalizeInvoice(req(`/api/invoices/${inv.id}/finalize`, 'PATCH', { business_id: B }, B2, A), { params: { id: inv.id } }));
    expect(fin.status).toBe(404);
    const cancel = await call(cancelInvoice(req(`/api/invoices/${inv.id}/cancel`, 'PATCH', { reason: 'x', business_id: B }, B2, A), { params: { id: inv.id } }));
    expect(cancel.status).toBe(404);
    const pfin = await call(finalizePurchase(req(`/api/purchases/${pur.id}/finalize`, 'PATCH', { business_id: B, user_id: A }, B2, A), { params: { id: pur.id } }));
    expect(pfin.status).toBe(404);
    const pcan = await call(cancelPurchase(req(`/api/purchases/${pur.id}/cancel`, 'POST', { reason: 'x', business_id: B }, B2, A), { params: { id: pur.id } }));
    expect(pcan.status).toBe(404);
    const conv = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { business_id: B }, B2, A), { params: { id: doc.id } }));
    expect(conv.status).toBe(404);
    const pay = await call(
      patchInvoicePayment(req(`/api/invoices/${inv.id}/payments`, 'PATCH', { amount: 10, business_id: B }, B2, A), { params: { id: inv.id } })
    );
    expect(pay.status).toBe(404);
    expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [inv.id])).rows[0].status).toBe('draft');
    expect((await pool.query(`SELECT status FROM purchases WHERE id = $1`, [pur.id])).rows[0].status).toBe('draft');
    expect((await pool.query(`SELECT converted_invoice_id FROM invoices WHERE id = $1`, [doc.id])).rows[0].converted_invoice_id).toBeNull();
  });

  test('35 reversing a reversal line is rejected', async () => {
    const j = await makeJournal(40);
    await call(reverseJournalRoute(req(`/api/journal-entries/${j.voucherId}/reverse`, 'POST', { reason: 'First' }), { params: { id: j.voucherId } }));
    const rev = (
      await pool.query<{ reversal_line_id: string; original_line_id: string }>(
        `SELECT reversal_line_id, original_line_id FROM ledger_entry_reversals WHERE voucher_id = $1 LIMIT 1`,
        [j.voucherId]
      )
    ).rows[0];
    await expect(
      pool.query(
        `INSERT INTO ledger_entry_reversals (original_line_id, reversal_line_id, business_id, voucher_type, voucher_id, reason)
         VALUES ($1, $2, $3, 'journal', $4, 'reversal of reversal')`,
        [rev.reversal_line_id, rev.original_line_id, B, j.voucherId]
      )
    ).rejects.toThrow();
    expect(await linesOf(j.voucherId)).toHaveLength(4);
  });

  test('36 concurrent journal reversal creates one reversal', async () => {
    const j = await makeJournal(70);
    const [a, b] = await Promise.all([
      call(reverseJournalRoute(req(`/api/journal-entries/${j.voucherId}/reverse`, 'POST', { reason: 'Race A' }), { params: { id: j.voucherId } })),
      call(reverseJournalRoute(req(`/api/journal-entries/${j.voucherId}/reverse`, 'POST', { reason: 'Race B' }), { params: { id: j.voucherId } })),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await linesOf(j.voucherId)).toHaveLength(4);
    expect(
      Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_reversals WHERE voucher_id = $1`, [j.voucherId])).rows[0].n)
    ).toBe(2);
  });
});
