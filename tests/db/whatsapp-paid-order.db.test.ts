/**
 * A WhatsApp bot order paid through a gateway becomes one final invoice with the receipt posted,
 * and the customer gets the confirmation and PDF bill once.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const mockText = jest.fn(async (..._args: unknown[]) => ({ transport: 'cloud', messageId: `wamid.t.${mockText.mock.calls.length}` }));
const mockPdf = jest.fn(async (..._args: unknown[]) => ({ transport: 'cloud', messageId: `wamid.p.${mockPdf.mock.calls.length}` }));
jest.mock('@/lib/whatsapp/business-transport', () => ({
  sendBusinessText: (...a: unknown[]) => mockText(...a),
  sendBusinessPdf: (...a: unknown[]) => mockPdf(...a),
}));
jest.mock('@/lib/pdf-generator', () => ({ generateInvoicePdf: jest.fn(async () => Buffer.from('%PDF-1.4 test')) }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn() }));
jest.mock('@/lib/whatsapp-crm', () => ({ storeOutgoingMessage: jest.fn(async () => 'stored') }));
jest.mock('@/lib/ai-agent/settings', () => ({
  loadSavedAgentSettings: jest.fn(async () => ({ postPaymentMessage: 'We will ship today.' })),
}));
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

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { completePaidWhatsAppOrder, invoicePaidWhatsAppOrder } from '@/lib/whatsapp/paid-order';
import { loadChatCustomerName, saveChatCustomerName, saveCollectedCustomerDetails } from '@/lib/ai-agent/order-items';

d('paid WhatsApp order: invoice and bill (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const ITEM = randomUUID();
  const CONV = randomUUID();
  const tag = B.slice(0, 8);
  const phone = `91${String(Date.now()).slice(-10)}`;
  let seq = 0;

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

  async function seedOrder(opts: { paid?: boolean; qty?: number } = {}): Promise<string> {
    const id = randomUUID();
    seq += 1;
    const qty = opts.qty ?? 2;
    const total = 118 * qty;
    await pool.query(
      `INSERT INTO sales_orders
         (id, business_id, order_number, order_date, status, subtotal, grand_total,
          whatsapp_conversation_id, payment_status)
       VALUES ($1, $2, $3, CURRENT_DATE, 'draft', $4, $4, $5, $6)`,
      [id, B, `SO-WA-${tag}-${seq}`, total, CONV, opts.paid === false ? 'unpaid' : 'paid'],
    );
    await pool.query(
      `INSERT INTO sales_order_items (sales_order_id, item_id, item_name, qty, unit_price, line_total)
       VALUES ($1, $2, 'Widget', $3, 118, $4)`,
      [id, ITEM, qty, total],
    );
    if (opts.paid !== false) {
      await pool.query(
        `INSERT INTO payment_transactions (business_id, order_id, provider, provider_payment_id, method, amount, status, raw_payload)
         VALUES ($1, $2, 'easebuzz', $3, 'upi_collect', $4, 'success', $5::jsonb)`,
        [B, id, `E${tag}${seq}`, total, JSON.stringify({ last_webhook: { easepayid: `E${tag}${seq}`, mode: 'UPI' } })],
      );
    }
    return id;
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (!/test/i.test(db.rows[0].db)) throw new Error(`Refusing to run against ${db.rows[0].db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular')`,
      [B, `WaPaid ${tag}`, `27AABCW${tag.slice(0, 4).toUpperCase()}A1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [A, B, `93${phone.slice(-8)}`],
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, hsn_sac, current_stock)
       VALUES ($1, $2, 'Widget', 'goods', 'PCS', 118, 40, 18, '847130', 100)`,
      [ITEM, B],
    );
    await pool.query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, whatsapp_display_name)
       VALUES ($1, $2, $3, '919999999999', $3, 'Asha')`,
      [CONV, B, phone],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM sales_orders WHERE business_id = $1`, [B]);
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

  beforeEach(() => {
    mockText.mockClear();
    mockPdf.mockClear();
  });

  test('a paid order becomes one final, fully paid invoice equal to the amount paid', async () => {
    const id = await seedOrder();
    const first = await invoicePaidWhatsAppOrder(B, id);
    expect(first).toMatchObject({ created: true, invoiceId: expect.any(String) });

    const inv = await pool.query(
      `SELECT status, document_type, grand_total::float8 AS grand, tax_total::float8 AS tax,
              paid_amount::float8 AS paid, balance_amount::float8 AS balance, customer_id, prices_include_gst,
              channel, sales_order_id
         FROM invoices WHERE id = $1`,
      [first!.invoiceId],
    );
    const row = inv.rows[0];
    expect(row).toMatchObject({ status: 'final', document_type: 'tax_invoice', prices_include_gst: true, channel: 'whatsapp', sales_order_id: id });
    expect(row.grand).toBeCloseTo(236, 2);
    expect(row.tax).toBeCloseTo(36, 2);
    expect(row.paid).toBeCloseTo(236, 2);
    expect(row.balance).toBeCloseTo(0, 2);

    const cust = await pool.query(`SELECT name, phone FROM customers WHERE id = $1`, [row.customer_id]);
    expect(cust.rows[0]).toMatchObject({ name: 'Asha', phone: phone.slice(-10) });

    const so = await pool.query(`SELECT status, converted_invoice_id, customer_id FROM sales_orders WHERE id = $1`, [id]);
    expect(so.rows[0]).toMatchObject({ status: 'fulfilled', converted_invoice_id: first!.invoiceId, customer_id: row.customer_id });

    const ful = await pool.query(
      `SELECT channel, status, invoice_id, customer_id, buyer_name FROM order_fulfilments WHERE sales_order_id = $1`,
      [id],
    );
    expect(ful.rows).toEqual([
      { channel: 'whatsapp', status: 'confirmed', invoice_id: first!.invoiceId, customer_id: row.customer_id, buyer_name: 'Asha' },
    ]);

    const pay = await pool.query(`SELECT payment_mode, amount::float8 AS amount FROM payments WHERE reference_id = $1`, [first!.invoiceId]);
    expect(pay.rows).toHaveLength(1);
    expect(pay.rows[0]).toMatchObject({ payment_mode: 'upi' });
    expect(pay.rows[0].amount).toBeCloseTo(236, 2);
  });

  test('invoicing again returns the same invoice and posts nothing new', async () => {
    const id = await seedOrder({ qty: 1 });
    const first = await invoicePaidWhatsAppOrder(B, id);
    const again = await invoicePaidWhatsAppOrder(B, id);
    expect(again).toEqual({ invoiceId: first!.invoiceId, invoiceNumber: first!.invoiceNumber, created: false });
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM payments WHERE reference_id = $1`, [first!.invoiceId]);
    expect(n.rows[0].n).toBe(1);
  });

  test('the customer gets the confirmation and the PDF bill once, however often it runs', async () => {
    const id = await seedOrder({ qty: 3 });
    await Promise.all([completePaidWhatsAppOrder(B, id), completePaidWhatsAppOrder(B, id)]);
    await completePaidWhatsAppOrder(B, id);

    expect(mockText).toHaveBeenCalledTimes(1);
    const [, to, text] = mockText.mock.calls[0] as [string, string, string];
    expect(to).toBe(phone);
    expect(text).toContain('Payment received');
    expect(text).toContain('₹354');
    expect(text).toMatch(/Bill no: \*.+\*/);
    expect(text).toContain('We will ship today.');
    expect(text).toMatch(/Track your order: \S+\/track\/[A-Za-z0-9_-]{24}/);
    const notified = await pool.query(`SELECT notified_statuses FROM order_fulfilments WHERE sales_order_id = $1`, [id]);
    expect(notified.rows[0].notified_statuses).toEqual(['confirmed']);

    expect(mockPdf).toHaveBeenCalledTimes(1);
    const [, pdfTo, pdf] = mockPdf.mock.calls[0] as [string, string, { buffer: Buffer; filename: string }];
    expect(pdfTo).toBe(phone);
    expect(pdf.filename).toMatch(/\.pdf$/);

    const inv = await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1 AND notes LIKE $2`, [B, `%SO-WA-${tag}-${seq}%`]);
    expect(inv.rows[0].n).toBe(1);
  });

  test('when the chat reply already confirmed the payment, only the bill is sent', async () => {
    const id = await seedOrder({ qty: 1 });
    await completePaidWhatsAppOrder(B, id, { confirmationSent: true });
    expect(mockText).not.toHaveBeenCalled();
    expect(mockPdf).toHaveBeenCalledTimes(1);
  });

  test('a failed bill send is retried on the next run', async () => {
    const id = await seedOrder({ qty: 1 });
    mockPdf.mockRejectedValueOnce(new Error('meta down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await completePaidWhatsAppOrder(B, id);
    spy.mockRestore();
    expect(mockPdf).toHaveBeenCalledTimes(1);
    await completePaidWhatsAppOrder(B, id);
    expect(mockPdf).toHaveBeenCalledTimes(2);
    expect(mockText).toHaveBeenCalledTimes(1);
  });

  test('the name the bot collected goes on the bill, but never overwrites a name the business entered', async () => {
    const custId = (
      await pool.query<{ id: string }>(
        `SELECT id FROM customers WHERE business_id = $1 AND right(phone, 10) = $2`,
        [B, phone.slice(-10)],
      )
    ).rows[0].id;
    await saveCollectedCustomerDetails(B, custId, { name: 'Asha Rao', email: 'asha@example.com', address: '12 MG Road, Pune' }, ['Asha', phone]);

    const id = await seedOrder({ qty: 1 });
    const inv = await invoicePaidWhatsAppOrder(B, id);
    const named = await pool.query(
      `SELECT c.name, c.email, c.shipping_address FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`,
      [inv!.invoiceId],
    );
    expect(named.rows[0]).toMatchObject({ name: 'Asha Rao', email: 'asha@example.com', shipping_address: '12 MG Road, Pune' });

    await saveCollectedCustomerDetails(B, custId, { name: 'Someone Else', email: 'other@example.com' }, ['Asha', phone]);
    const kept = await pool.query(`SELECT name, email FROM customers WHERE id = $1`, [custId]);
    expect(kept.rows[0]).toEqual({ name: 'Asha Rao', email: 'asha@example.com' });
  });

  test('a new customer is billed under the name they gave in chat, not their WhatsApp profile name', async () => {
    const conv = randomUUID();
    const newPhone = `92${String(Date.now()).slice(-10)}`;
    await pool.query(
      `INSERT INTO whatsapp_conversations (id, business_id, from_number, to_number, conversation_id, whatsapp_display_name)
       VALUES ($1, $2, $3, '919999999999', $3, '🌸Mom🌸')`,
      [conv, B, newPhone],
    );
    await saveChatCustomerName(B, conv, 'Meera Iyer');
    expect(await loadChatCustomerName(B, conv)).toBe('Meera Iyer');

    const id = await seedOrder({ qty: 1 });
    await pool.query(`UPDATE sales_orders SET whatsapp_conversation_id = $1 WHERE id = $2`, [conv, id]);
    const inv = await invoicePaidWhatsAppOrder(B, id);
    const c = await pool.query(
      `SELECT c.name, c.phone FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`,
      [inv!.invoiceId],
    );
    expect(c.rows[0]).toEqual({ name: 'Meera Iyer', phone: newPhone.slice(-10) });
  });

  test('an unpaid order is not invoiced and nothing is sent', async () => {
    const id = await seedOrder({ paid: false });
    expect(await invoicePaidWhatsAppOrder(B, id)).toBeNull();
    await completePaidWhatsAppOrder(B, id);
    expect(mockText).not.toHaveBeenCalled();
    expect(mockPdf).not.toHaveBeenCalled();
    const so = await pool.query(`SELECT status, converted_invoice_id FROM sales_orders WHERE id = $1`, [id]);
    expect(so.rows[0]).toMatchObject({ status: 'draft', converted_invoice_id: null });
  });
});
