/**
 * WhatsApp shop settings, item selection, cart links and cart orders against a real schema.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const mockPaymentLink = jest.fn(async (..._args: unknown[]) => ({ link: 'https://rzp.io/i/test', source: 'psp' }));
jest.mock('@/lib/services/payment-service', () => ({
  generatePaymentLinkForBusiness: (...a: unknown[]) => mockPaymentLink(...a),
}));
jest.mock('@/lib/whatsapp/business-transport', () => ({
  sendBusinessText: jest.fn(async () => ({ transport: 'baileys', messageId: null })),
  sendBusinessLink: jest.fn(async () => ({ transport: 'baileys', messageId: null, text: '' })),
}));
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { getShopSettings, saveShopSettings, recordShopSync } from '@/lib/whatsapp-shop/settings';
import { loadShopItems } from '@/lib/whatsapp-shop/items';
import { createShopLink, resolveShopLink, recordShopLinkOrder } from '@/lib/whatsapp-shop/links';
import { placeShopOrder } from '@/lib/whatsapp-shop/order';

d('WhatsApp shop (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const A = randomUUID();
  const WIDGET = randomUUID();
  const GADGET = randomUUID();
  const SOLD_OUT = randomUUID();
  const FREE = randomUUID();
  const SERVICE = randomUUID();
  const CONV = randomUUID();
  const tag = B.slice(0, 8);
  const phone = `91${String(Date.now()).slice(-10)}`;

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

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (!/test/i.test(db.rows[0].db)) throw new Error(`Refusing to run against ${db.rows[0].db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular')`,
      [B, `WaShop ${tag}`, `27AABCS${tag.slice(0, 4).toUpperCase()}A1Z5`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [A, B, `94${phone.slice(-8)}`],
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT ensure_standard_account_heads($1)`, [B]);
    const items: Array<[string, string, string, number, number, boolean]> = [
      [WIDGET, 'Widget', 'goods', 118, 100, true],
      [GADGET, 'Gadget', 'goods', 50, 5, false],
      [SOLD_OUT, 'Sold Out Thing', 'goods', 80, 0, true],
      [FREE, 'Free Sample', 'goods', 0, 10, true],
      [SERVICE, 'Gift Wrap', 'service', 20, 0, true],
    ];
    for (const [id, name, type, price, stock, inStore] of items) {
      await pool.query(
        `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, current_stock, show_in_store)
         VALUES ($1, $2, $3, $4, 'PCS', $5, 1, 18, $6, $7)`,
        [id, B, name, type, price, stock, inStore],
      );
    }
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
      await pool.query(`DELETE FROM whatsapp_conversation_states WHERE business_id = $1`, [B]).catch(() => {});
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

  test('settings default off, save, and a catalog change forgets synced items', async () => {
    expect(await getShopSettings(B)).toMatchObject({ enabled: false, metaCatalogId: null, itemScope: 'all' });

    const saved = await saveShopSettings(B, { enabled: true, metaCatalogId: '123456789', welcomeText: '  Hi there  ' });
    expect(saved).toMatchObject({ enabled: true, metaCatalogId: '123456789', welcomeText: 'Hi there' });

    await recordShopSync(B, { at: new Date().toISOString(), pushed: 2, removed: 0, unchanged: 0, skippedNoImage: 0, errors: [] });
    await pool.query(
      `INSERT INTO whatsapp_catalog_items (business_id, item_id, catalog_id, content_hash) VALUES ($1, $2, '123456789', 'h')`,
      [B, WIDGET],
    );
    expect((await getShopSettings(B)).lastSyncSummary).toMatchObject({ pushed: 2 });

    const sameCatalog = await saveShopSettings(B, { hideOutOfStock: true });
    expect(sameCatalog.lastSyncedAt).not.toBeNull();

    const moved = await saveShopSettings(B, { metaCatalogId: '987654321', hideOutOfStock: false });
    expect(moved).toMatchObject({ metaCatalogId: '987654321', lastSyncedAt: null, lastSyncSummary: null });
    const left = await pool.query(`SELECT 1 FROM whatsapp_catalog_items WHERE business_id = $1`, [B]);
    expect(left.rowCount).toBe(0);

    await expect(saveShopSettings(B, { metaCatalogId: 'abc' })).rejects.toThrow(/Catalog ID/);
    await expect(
      pool.query(`UPDATE whatsapp_shop_settings SET item_scope = 'bogus' WHERE business_id = $1`, [B]),
    ).rejects.toThrow();
  });

  test('items: priced, active, scope and stock filters', async () => {
    const all = await loadShopItems(B, { itemScope: 'all', hideOutOfStock: false });
    expect(all.map((i) => i.name).sort()).toEqual(['Gadget', 'Gift Wrap', 'Sold Out Thing', 'Widget']);
    expect(all.find((i) => i.name === 'Gift Wrap')!.inStock).toBe(true);
    expect(all.find((i) => i.name === 'Sold Out Thing')!.inStock).toBe(false);

    const inStock = await loadShopItems(B, { itemScope: 'all', hideOutOfStock: true });
    expect(inStock.map((i) => i.name)).not.toContain('Sold Out Thing');

    const store = await loadShopItems(B, { itemScope: 'store', hideOutOfStock: false });
    expect(store.map((i) => i.name)).not.toContain('Gadget');

    const picked = await loadShopItems(B, { itemScope: 'all', hideOutOfStock: false }, { ids: [WIDGET, FREE, 'nope'] });
    expect(picked.map((i) => i.id)).toEqual([WIDGET]);
  });

  test('cart links resolve to their business and expire', async () => {
    const link = await createShopLink({ businessId: B, phone: `+${phone}`, conversationUuid: CONV });
    const token = link.split('/wa-shop/')[1];
    expect(await resolveShopLink(token)).toEqual({ businessId: B, phone, conversationUuid: CONV });
    expect(await resolveShopLink('x'.repeat(32))).toBeNull();
    expect(await resolveShopLink('bad token!')).toBeNull();

    await pool.query(
      `UPDATE whatsapp_shop_links SET expires_at = NOW() - interval '1 minute' WHERE business_id = $1`,
      [B],
    );
    expect(await resolveShopLink(token)).toBeNull();
  });

  test('a cart becomes a draft order priced from the catalogue, replacing the unpaid one', async () => {
    const first = await placeShopOrder({
      businessId: B,
      phone,
      lines: [
        { itemId: WIDGET, quantity: 1 },
        { itemId: WIDGET.toUpperCase(), quantity: 1 },
        { itemId: SERVICE, quantity: 1 },
        { itemId: FREE, quantity: 3 },
      ],
      customerName: 'Asha',
      address: '12 MG Road',
    });
    if (!first.ok) throw new Error(`expected an order, got ${first.reason}`);
    expect(first.total).toBe(118 * 2 + 20);
    expect(first.unavailable).toEqual(['Free Sample']);
    expect(first).toMatchObject({ paymentLink: 'https://rzp.io/i/test', manualPayment: false });

    const order = await pool.query(
      `SELECT status, payment_status, whatsapp_conversation_id, notes, grand_total::float8 AS total
         FROM sales_orders WHERE id = $1 AND business_id = $2`,
      [first.orderId, B],
    );
    expect(order.rows[0]).toMatchObject({ status: 'draft', whatsapp_conversation_id: CONV, total: 256 });
    expect(order.rows[0].notes).toContain('WhatsApp shop order');
    const lines = await pool.query(
      `SELECT item_id, qty::float8 AS qty, unit_price::float8 AS price FROM sales_order_items WHERE sales_order_id = $1 ORDER BY unit_price DESC`,
      [first.orderId],
    );
    expect(lines.rows).toEqual([
      { item_id: WIDGET, qty: 2, price: 118 },
      { item_id: SERVICE, qty: 1, price: 20 },
    ]);

    const conv = await pool.query(
      `SELECT state, context->>'order_id' AS order_id FROM whatsapp_conversation_states WHERE business_id = $1 AND conversation_id = $2`,
      [B, phone],
    );
    expect(conv.rows[0]).toEqual({ state: 'waiting_payment', order_id: first.orderId });

    const link = await createShopLink({ businessId: B, phone, conversationUuid: CONV });
    const token = link.split('/wa-shop/')[1];
    await recordShopLinkOrder(token, first.orderId);
    const rec = await pool.query(`SELECT last_order_id FROM whatsapp_shop_links WHERE business_id = $1 AND last_order_id IS NOT NULL`, [B]);
    expect(rec.rows[0].last_order_id).toBe(first.orderId);

    mockPaymentLink.mockResolvedValueOnce({ link: 'https://pay.example/upi', source: 'manual' });
    const second = await placeShopOrder({ businessId: B, phone, lines: [{ itemId: GADGET, quantity: 2 }] });
    if (!second.ok) throw new Error(`expected an order, got ${second.reason}`);
    expect(second).toMatchObject({ total: 100, manualPayment: true });
    const old = await pool.query(`SELECT status FROM sales_orders WHERE id = $1`, [first.orderId]);
    expect(old.rows[0].status).toBe('cancelled');

    expect(await placeShopOrder({ businessId: B, phone, lines: [{ itemId: FREE, quantity: 1 }] })).toEqual({
      ok: false,
      reason: 'NO_ITEMS',
      unavailable: ['Free Sample'],
    });

    await saveShopSettings(B, { enabled: false });
    expect(await placeShopOrder({ businessId: B, phone, lines: [{ itemId: WIDGET, quantity: 1 }] })).toMatchObject({
      ok: false,
      reason: 'SHOP_OFF',
    });
  });
});
