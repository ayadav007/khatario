/**
 * Phase 3.4: a proforma is not posted. Conversion is the only way it becomes a final invoice.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
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

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { PATCH as finalizeInvoice } from '@/app/api/invoices/[id]/finalize/route';
import { PATCH as cancelInvoice } from '@/app/api/invoices/[id]/cancel/route';
import { PATCH as patchInvoice } from '@/app/api/invoices/[id]/route';
import { POST as convertProforma } from '@/app/api/invoices/[id]/convert-to-tax-invoice/route';
import { POST as postLifecycle } from '@/app/api/invoices/[id]/proforma-lifecycle/route';
import { POST as postInvoice } from '@/app/api/invoices/route';

d('Phase 3.4 proforma and estimate lifecycle (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const CUST = randomUUID();
  const OTHER_CUST = randomUUID();
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

  const req = (path: string, method: string, body: unknown, business = B) =>
    new NextRequest(`http://localhost${path}?user_id=${randomUUID()}&business_id=${B2}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-user-id': randomUUID(),
        'x-authenticated-user-id': A,
        'x-authenticated-business-id': business,
        'x-authenticated-session-version': '1',
      },
      body: JSON.stringify(body),
    });

  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json: json as any };
  };

  async function stockQty() {
    const row = (
      await pool.query(
        `SELECT COALESCE(quantity, 0)::float8 AS q FROM branch_item_stock
          WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
        [B, BR, ITEM]
      )
    ).rows[0];
    return Number(row?.q ?? 0);
  }

  async function movements(referenceId: string) {
    return Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE reference_id = $1`, [referenceId])).rows[0].n
    );
  }

  async function makeProforma(opts?: { qty?: number; estimateStatus?: string; status?: string; discount?: number }) {
    const id = randomUUID();
    const qty = opts?.qty ?? 2;
    const price = 100;
    const grand = qty * price;
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, discount_total, tax_total, cgst_total, sgst_total, igst_total,
          grand_total, paid_amount, balance_amount, payment_status, branch_id, estimate_status, proforma_lifecycle_status)
       VALUES ($1,$2,$3,$4,'2026-09-20',$5,'proforma_invoice','27',$6,0,0,0,0,0,$6,0,$6,'unpaid',$7,$8,'created')`,
      [id, B, CUST, `PI-${tag}-${id.slice(0, 4)}`, opts?.status ?? 'draft', grand, BR, opts?.estimateStatus ?? 'draft']
    );
    await pool.query(
      `INSERT INTO invoice_items (invoice_id, item_id, item_name, hsn_sac, quantity, unit_price, discount_percent, tax_rate, tax_amount, line_total)
       VALUES ($1,$2,'Widget','847130', $3, $4, $5, 0, 0, $6)`,
      [id, ITEM, qty, price, opts?.discount ?? 0, grand]
    );
    return { id, qty, grand };
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS converted_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_converted_invoice_id
        ON invoices (converted_invoice_id) WHERE converted_invoice_id IS NOT NULL;
    `);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular'), ($4, $5, $6, '27', 'regular')`,
      [B, `Phase34 ${tag}`, `27AABCU${tag.slice(0, 4).toUpperCase()}A1Z5`, B2, `Phase34b ${tag}`, `29AABCU${tag.slice(0, 4).toUpperCase()}A1Z5`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    const phone = Date.now().toString().slice(-8);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1, $2, 'Clerk', $3, true)`,
      [A, B, `93${phone}`]
    );
    await pool.query(`UPDATE users SET auth_session_version = 1 WHERE id = $1`, [A]).catch(() => {});
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO customers (id, business_id, name, state_code, current_balance) VALUES ($1,$2,'Asha','27',0), ($3,$4,'Other','27',0)`,
      [CUST, B, OTHER_CUST, B2]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac)
       VALUES ($1, $2, 'Widget', 'goods', 'NOS', 100, 40, 0, '847130')`,
      [ITEM, B]
    );
    await pool.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity)
       VALUES ($1, $2, $3, 10)
       ON CONFLICT (business_id, branch_id, item_id) DO UPDATE SET quantity = 10`,
      [B, BR, ITEM]
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

  test('finalizing a proforma does not deduct stock or post a ledger', async () => {
    const doc = await makeProforma();
    const before = await stockQty();
    const res = await call(
      finalizeInvoice(req(`/api/invoices/${doc.id}/finalize`, 'PATCH', { user_id: B2, business_id: B2 }), { params: { id: doc.id } })
    );
    expect(res.status).toBe(200);
    expect(res.json.invoice.status).toBe('final');
    expect(res.json.invoice.document_type).toBe('proforma_invoice');
    expect(await stockQty()).toBe(before);
    expect(await movements(doc.id)).toBe(0);
    const lines = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE voucher_id = $1`, [doc.id])).rows[0].n
    );
    expect(lines).toBe(0);
  });

  test('cancelling a proforma does not restore stock or reverse accounting', async () => {
    const doc = await makeProforma();
    await pool.query(`UPDATE invoices SET status = 'final' WHERE id = $1`, [doc.id]);
    const before = await stockQty();
    const linesBefore = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [B])).rows[0].n
    );
    const res = await call(
      cancelInvoice(req(`/api/invoices/${doc.id}/cancel`, 'PATCH', { reason: 'Customer declined', user_id: B2, business_id: B2 }), {
        params: { id: doc.id },
      })
    );
    expect(res.status).toBe(200);
    expect(res.json.invoice.status).toBe('cancelled');
    expect(res.json.invoice.proforma_lifecycle_status).toBe('cancelled');
    expect(res.json.invoice.cancellation_details.reason).toBe('Customer declined');
    expect(await stockQty()).toBe(before);
    expect(await movements(doc.id)).toBe(0);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [B])).rows[0].n)).toBe(linesBefore);
  });

  test('a cancelled, rejected, or expired proforma cannot be converted', async () => {
    const cancelled = await makeProforma({ status: 'cancelled' });
    const rejected = await makeProforma({ estimateStatus: 'rejected' });
    const expired = await makeProforma({ estimateStatus: 'expired' });
    const c = await call(convertProforma(req(`/api/invoices/${cancelled.id}/convert-to-tax-invoice`, 'POST', { status: 'final', business_id: B2, user_id: B2 }), { params: { id: cancelled.id } }));
    const r = await call(convertProforma(req(`/api/invoices/${rejected.id}/convert-to-tax-invoice`, 'POST', { user_id: B2 }), { params: { id: rejected.id } }));
    const e = await call(convertProforma(req(`/api/invoices/${expired.id}/convert-to-tax-invoice`, 'POST', {}), { params: { id: expired.id } }));
    expect(c.status).toBe(409);
    expect(c.json.code).toBe('PROFORMA_CANCELLED');
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('ESTIMATE_NOT_CONVERTIBLE');
    expect(e.status).toBe(409);
    expect(e.json.code).toBe('ESTIMATE_NOT_CONVERTIBLE');
  });

  test('conversion creates one final invoice, posts stock and the existing invoice ledger once, and cannot run twice', async () => {
    const doc = await makeProforma({ discount: 10 });
    const before = await stockQty();
    const res = await call(
      convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { status: 'draft', business_id: B2, created_by: B2 }), {
        params: { id: doc.id },
      })
    );
    expect(res.status).toBe(200);
    const invoiceId = res.json.invoice_id as string;
    const created = (
      await pool.query(
        `SELECT status, document_type, customer_id FROM invoices WHERE id = $1`,
        [invoiceId]
      )
    ).rows[0];
    expect(created).toEqual({ status: 'final', document_type: 'tax_invoice', customer_id: CUST });
    const line = (
      await pool.query(
        `SELECT quantity::float8 AS qty, discount_percent::float8 AS disc, tax_rate::float8 AS tax
           FROM invoice_items WHERE invoice_id = $1`,
        [invoiceId]
      )
    ).rows[0];
    expect(Number(line.qty)).toBe(2);
    expect(Number(line.disc)).toBe(10);
    expect(Number(line.tax)).toBe(0);
    expect(await stockQty()).toBe(before - 2);
    expect(await movements(invoiceId)).toBe(1);
    expect(await movements(doc.id)).toBe(0);
    const ledger = (
      await pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM(debit),0)::float8 AS dr, COALESCE(SUM(credit),0)::float8 AS cr
           FROM ledger_entry_lines WHERE voucher_type = 'invoice' AND voucher_id = $1`,
        [invoiceId]
      )
    ).rows[0];
    expect(Number(ledger.n)).toBeGreaterThan(0);
    expect(Number(ledger.dr)).toBeCloseTo(Number(ledger.cr), 2);

    const source = (
      await pool.query(
        `SELECT estimate_status, proforma_lifecycle_status, converted_invoice_id FROM invoices WHERE id = $1`,
        [doc.id]
      )
    ).rows[0];
    expect(source.estimate_status).toBe('converted');
    expect(source.proforma_lifecycle_status).toBe('converted_to_tax_invoice');
    expect(source.converted_invoice_id).toBe(invoiceId);

    const again = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', {}), { params: { id: doc.id } }));
    expect(again.status).toBe(409);
    expect(again.json.code).toBe('PROFORMA_ALREADY_CONVERTED');
    expect(again.json.invoice_id).toBe(invoiceId);
    expect(await stockQty()).toBe(before - 2);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE converted_invoice_id = $1 OR id = $1`, [invoiceId])).rows[0].n)).toBe(2);
  });

  test('two concurrent conversions create only one invoice', async () => {
    const doc = await makeProforma();
    const before = await stockQty();
    const [a, b] = await Promise.all([
      call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', {}), { params: { id: doc.id } })),
      call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { business_id: B2 }), { params: { id: doc.id } })),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 409 ? a : b;
    expect(loser.json.code).toBe('PROFORMA_ALREADY_CONVERTED');
    expect(loser.json.invoice_id).toBe(winner.json.invoice_id);
    expect(await stockQty()).toBe(before - 2);
    const n = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1 AND document_type = 'tax_invoice' AND id = $2`, [B, winner.json.invoice_id])).rows[0].n
    );
    expect(n).toBe(1);
  });

  test('a failed conversion rolls back the proforma and does not leave an invoice', async () => {
    const doc = await makeProforma();
    await pool.query(`UPDATE invoices SET customer_id = $2 WHERE id = $1`, [doc.id, OTHER_CUST]);
    const before = await stockQty();
    const invoicesBefore = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [B])).rows[0].n);
    const res = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', {}), { params: { id: doc.id } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json.code).not.toBe('PROFORMA_ALREADY_CONVERTED');
    const source = (
      await pool.query(
        `SELECT status, estimate_status, proforma_lifecycle_status, converted_invoice_id FROM invoices WHERE id = $1`,
        [doc.id]
      )
    ).rows[0];
    expect(source.status).not.toBe('final');
    expect(source.estimate_status).not.toBe('converted');
    expect(source.proforma_lifecycle_status).not.toBe('converted_to_tax_invoice');
    expect(source.converted_invoice_id).toBeNull();
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [B])).rows[0].n)).toBe(invoicesBefore);
    expect(await stockQty()).toBe(before);
  });

  test('another business cannot convert the proforma', async () => {
    const doc = await makeProforma();
    const res = await call(
      convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { business_id: B }, B2), { params: { id: doc.id } })
    );
    expect(res.status).toBe(404);
    const source = (await pool.query(`SELECT converted_invoice_id, estimate_status FROM invoices WHERE id = $1`, [doc.id])).rows[0];
    expect(source.converted_invoice_id).toBeNull();
    expect(source.estimate_status).toBe('draft');
  });

  test('lifecycle and a client converted flag cannot invent a conversion', async () => {
    const doc = await makeProforma();
    const flagged = await call(
      patchInvoice(
        req(`/api/invoices/${doc.id}`, 'PATCH', { estimate_status: 'converted', business_id: B2, user_id: B2 }),
        { params: { id: doc.id } }
      )
    );
    expect(flagged.status).toBe(409);
    expect(flagged.json.code).toBe('ESTIMATE_CONVERSION_REQUIRED');

    const lifecycle = await call(
      postLifecycle(
        req(`/api/invoices/${doc.id}/proforma-lifecycle`, 'POST', { status: 'converted_to_tax_invoice', userId: B2, business_id: B2 }),
        { params: { id: doc.id } }
      )
    );
    expect(lifecycle.status).toBe(409);
    expect(lifecycle.json.code).toBe('PROFORMA_CONVERSION_REQUIRED');

    const otherBusiness = await call(
      patchInvoice(req(`/api/invoices/${doc.id}`, 'PATCH', { estimate_status: 'sent', business_id: B }, B2), { params: { id: doc.id } })
    );
    expect(otherBusiness.status).toBe(404);

    const source = (
      await pool.query(`SELECT estimate_status, proforma_lifecycle_status, converted_invoice_id FROM invoices WHERE id = $1`, [doc.id])
    ).rows[0];
    expect(source.estimate_status).toBe('draft');
    expect(source.proforma_lifecycle_status).toBe('created');
    expect(source.converted_invoice_id).toBeNull();
  });

  test('creating a proforma posts no ledger and deducts no stock', async () => {
    const beforeStock = await stockQty();
    const beforeLines = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [B])).rows[0].n
    );
    const beforeMoves = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE business_id = $1`, [B])).rows[0].n
    );
    const res = await call(
      postInvoice(
        req('/api/invoices', 'POST', {
          status: 'final',
          document_type: 'proforma_invoice',
          invoice_date: '2026-09-20',
          branch_id: BR,
          customer_id: CUST,
          business_id: B2,
          user_id: B2,
          created_by: A,
          items: [{ item_id: ITEM, item_name: 'Widget', hsn_sac: '847130', quantity: 2, unit_price: 100, tax_rate: 0 }],
        })
      )
    );
    expect(res.status).toBe(201);
    const id = res.json.invoice.id as string;
    const doc = (
      await pool.query(`SELECT business_id, document_type, status FROM invoices WHERE id = $1`, [id])
    ).rows[0];
    expect(doc).toEqual({ business_id: B, document_type: 'proforma_invoice', status: 'final' });
    expect(await stockQty()).toBe(beforeStock);
    expect(await movements(id)).toBe(0);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE business_id = $1`, [B])).rows[0].n)).toBe(beforeMoves);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [B])).rows[0].n)).toBe(beforeLines);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE voucher_id = $1`, [id])).rows[0].n)).toBe(0);
  });

  test('a converted invoice is not posted again when finalize is called', async () => {
    const doc = await makeProforma();
    const converted = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { status: 'draft' }), { params: { id: doc.id } }));
    expect(converted.status).toBe(200);
    const invoiceId = converted.json.invoice_id as string;
    const linesBefore = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE voucher_type = 'invoice' AND voucher_id = $1`, [invoiceId])).rows[0].n
    );
    const vouchers = Number(
      (await pool.query(`SELECT COUNT(DISTINCT voucher_id)::int AS n FROM ledger_entry_lines WHERE voucher_type = 'invoice' AND voucher_id = $1`, [invoiceId])).rows[0].n
    );
    expect(linesBefore).toBeGreaterThan(0);
    expect(vouchers).toBe(1);
    const stockBefore = await stockQty();
    const movesBefore = await movements(invoiceId);
    const again = await call(finalizeInvoice(req(`/api/invoices/${invoiceId}/finalize`, 'PATCH', { user_id: B2, business_id: B2 }), { params: { id: invoiceId } }));
    expect(again.status).toBe(200);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE voucher_type = 'invoice' AND voucher_id = $1`, [invoiceId])).rows[0].n)).toBe(linesBefore);
    expect(await stockQty()).toBe(stockBefore);
    expect(await movements(invoiceId)).toBe(movesBefore);
  });

  test('body business_id, user_id and created_by do not choose the tenant or the actor', async () => {
    const doc = await makeProforma();
    const res = await call(
      convertProforma(
        req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { business_id: B2, user_id: B2, created_by: B2, userId: B2 }),
        { params: { id: doc.id } }
      )
    );
    expect(res.status).toBe(200);
    const row = (
      await pool.query(`SELECT business_id, created_by FROM invoices WHERE id = $1`, [res.json.invoice_id])
    ).rows[0];
    expect(row.business_id).toBe(B);
    expect(row.created_by).toBe(A);
    const source = (await pool.query(`SELECT business_id FROM invoices WHERE id = $1`, [doc.id])).rows[0];
    expect(source.business_id).toBe(B);
  });

  test('estimate_status converted without an invoice id blocks conversion and creates nothing', async () => {
    const doc = await makeProforma();
    await pool.query(
      `UPDATE invoices SET estimate_status = 'converted', converted_invoice_id = NULL WHERE id = $1`,
      [doc.id]
    );
    const before = await stockQty();
    const invoicesBefore = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [B])).rows[0].n);
    const res = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { business_id: B, user_id: A }), { params: { id: doc.id } }));
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('PROFORMA_ALREADY_CONVERTED');
    expect(res.json.invoice_id).toBeNull();
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [B])).rows[0].n)).toBe(invoicesBefore);
    expect(await stockQty()).toBe(before);
    const source = (await pool.query(`SELECT estimate_status, converted_invoice_id FROM invoices WHERE id = $1`, [doc.id])).rows[0];
    expect(source.estimate_status).toBe('converted');
    expect(source.converted_invoice_id).toBeNull();
  });

  test('a cancelled proforma cannot be marked converted through the lifecycle endpoint', async () => {
    const doc = await makeProforma({ status: 'cancelled' });
    await pool.query(`UPDATE invoices SET proforma_lifecycle_status = 'cancelled' WHERE id = $1`, [doc.id]);
    const asConverted = await call(
      postLifecycle(
        req(`/api/invoices/${doc.id}/proforma-lifecycle`, 'POST', { status: 'converted_to_tax_invoice', userId: B2, business_id: B2 }),
        { params: { id: doc.id } }
      )
    );
    expect(asConverted.status).toBe(409);
    expect(asConverted.json.code).toBe('PROFORMA_CONVERSION_REQUIRED');
    const reopen = await call(
      postLifecycle(req(`/api/invoices/${doc.id}/proforma-lifecycle`, 'POST', { status: 'sent', userId: B2, business_id: B }), { params: { id: doc.id } })
    );
    expect(reopen.status).toBe(409);
    expect(reopen.json.code).toBe('PROFORMA_CANCELLED');
    const source = (
      await pool.query(`SELECT status, proforma_lifecycle_status, estimate_status, converted_invoice_id FROM invoices WHERE id = $1`, [doc.id])
    ).rows[0];
    expect(source.status).toBe('cancelled');
    expect(source.proforma_lifecycle_status).toBe('cancelled');
    expect(source.estimate_status).toBe('draft');
    expect(source.converted_invoice_id).toBeNull();
  });

  test('a failed conversion leaves no ledger lines or stock movement', async () => {
    const doc = await makeProforma();
    await pool.query(`UPDATE invoices SET customer_id = $2 WHERE id = $1`, [doc.id, OTHER_CUST]);
    const linesBefore = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [B])).rows[0].n
    );
    const movesBefore = Number(
      (await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE business_id = $1`, [B])).rows[0].n
    );
    const res = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', { created_by: B2 }), { params: { id: doc.id } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ledger_entry_lines WHERE business_id = $1`, [B])).rows[0].n)).toBe(linesBefore);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE business_id = $1`, [B])).rows[0].n)).toBe(movesBefore);
    expect((await pool.query(`SELECT converted_invoice_id FROM invoices WHERE id = $1`, [doc.id])).rows[0].converted_invoice_id).toBeNull();
  });

  test('a converted proforma cannot be moved back by the lifecycle endpoint', async () => {
    const doc = await makeProforma();
    const converted = await call(convertProforma(req(`/api/invoices/${doc.id}/convert-to-tax-invoice`, 'POST', {}), { params: { id: doc.id } }));
    expect(converted.status).toBe(200);
    const back = await call(
      postLifecycle(req(`/api/invoices/${doc.id}/proforma-lifecycle`, 'POST', { status: 'sent', userId: B2 }), { params: { id: doc.id } })
    );
    expect(back.status).toBe(409);
    expect(back.json.code).toBe('PROFORMA_ALREADY_CONVERTED');
    const source = (await pool.query(`SELECT proforma_lifecycle_status FROM invoices WHERE id = $1`, [doc.id])).rows[0];
    expect(source.proforma_lifecycle_status).toBe('converted_to_tax_invoice');
  });
});
