/**
 * Scan & Add Items: retry-safe item create and the shop barcode check.
 * Writes only after current_database() is kh_phase2_test on port 5433.
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
    throw new Error('Refusing scan & add tests: database host is not local');
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
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as postItem } from '@/app/api/items/route';
import { GET as getBarcode } from '@/app/api/items/scan-add/barcode/route';
import { GET as getLookup } from '@/app/api/items/scan-add/lookup/route';
import { POST as postReadLabel } from '@/app/api/items/scan-add/read-label/route';
import { POST as postVariant } from '@/app/api/items/scan-add/variant/route';
import { POST as postAdjustment } from '@/app/api/inventory-adjustments/route';
import { resetProviderSlotsForTests } from '@/lib/product-lookup/service';

/** Provider answers for the lookup tests. No request leaves the machine. */
const providerFetch = jest.fn(async (url: string) => {
  const found = url.includes('myproduct.guru/lookup/8901396151005');
  const body = found
    ? { ean: '8901396151005', name: 'harpic', brand: 'Harpic', quantity: '500 ml', category_name: 'Toilet cleaner', verified: true, certainty: 65, web_url: 'https://myproduct.guru/p/8901396151005' }
    : { status: 0 };
  return { status: found ? 200 : 404, url, json: async () => body } as unknown as Response;
});

describe('scan & add items', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const OTHER = randomUUID();
  const BR = randomUUID();
  const OBR = randomUUID();
  const USER = randomUUID();
  const OUSER = randomUUID();
  const tag = B.slice(0, 8);
  const auth = (userId: string, businessId: string) => ({
    'content-type': 'application/json',
    'x-authenticated-user-id': userId,
    'x-authenticated-business-id': businessId,
    'x-authenticated-session-version': '1',
  });

  async function create(body: Record<string, unknown>, key?: string, as: [string, string] = [USER, B]) {
    const res = await postItem(
      new NextRequest('http://localhost/api/items', {
        method: 'POST',
        headers: { ...auth(as[0], as[1]), ...(key ? { 'x-idempotency-key': key } : {}) },
        body: JSON.stringify(body),
      })
    );
    return { status: res.status, json: await res.json() };
  }

  async function lookup(code: string, as: [string, string] = [USER, B]) {
    const res = await getBarcode(
      new NextRequest(`http://localhost/api/items/scan-add/barcode?code=${encodeURIComponent(code)}`, {
        headers: auth(as[0], as[1]),
      })
    );
    return { status: res.status, json: await res.json() };
  }

  async function stockFacts(itemId: string) {
    const r = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM items WHERE business_id = $2 AND name = (SELECT name FROM items WHERE id = $1)) AS items,
         (SELECT COUNT(*)::int FROM stock_movements WHERE item_id = $1) AS movements,
         (SELECT COALESCE(SUM(quantity), 0)::numeric FROM stock_movements WHERE item_id = $1) AS moved,
         (SELECT current_stock FROM items WHERE id = $1) AS current_stock,
         (SELECT COALESCE(SUM(debit), 0)::numeric FROM ledger_entry_lines
           WHERE business_id = $2 AND voucher_id = $1 AND voucher_type = 'opening_stock') AS opening_value`,
      [itemId, B]
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !(info.addr.startsWith('127.') || info.addr.startsWith('::1'))) {
      throw new Error(`Refusing scan & add tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations/409_items_scan_onboarding_feature.sql'), 'utf8'));
    await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations/410_product_lookup_cache.sql'), 'utf8'));
    await pool.query(
      `INSERT INTO businesses (id, name, state_code, gst_registration_type) VALUES ($1, $2, '27', 'regular'), ($3, $4, '27', 'regular')`,
      [B, `Scan add ${tag}`, OTHER, `Scan add other ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true), ($3, $4, 'Main', '27', true, true, true)`,
      [BR, B, OBR, OTHER]
    );
    const phone = Date.now().toString().slice(-9);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Owner', $3, true, 1, true), ($4, $5, 'Other owner', $6, true, 1, true)`,
      [USER, B, `6${phone}`, OUSER, OTHER, `7${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [OTHER]);
    // Free plan, so the item limit check runs exactly as it does for a new shop.
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', 'free', 'active', CURRENT_DATE, CURRENT_DATE + 365)`,
      [B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER]]);
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

  test('the feature is on for every plan', async () => {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS plans,
              COUNT(f.plan_id) FILTER (WHERE f.enabled)::int AS enabled
         FROM subscription_plans p
         LEFT JOIN subscription_plan_features f ON f.plan_id = p.id AND f.feature_id = 'items_scan_onboarding'`
    );
    expect(r.rows[0].plans).toBeGreaterThan(0);
    expect(r.rows[0].enabled).toBe(r.rows[0].plans);
  });

  test('a retried save returns the same item and posts opening stock once', async () => {
    const key = randomUUID();
    const body = { name: `Parle-G 100 g ${tag}`, barcode: '0089012345675', unit: 'PCS', purchase_price: 8, selling_price: 10, mrp: 10, opening_stock: 20, net_quantity: '100 g' };
    const first = await create(body, key);
    expect([first.status, first.json.error]).toEqual([201, undefined]);
    expect(first.json.item.barcode).toBe('0089012345675');

    const retry = await create(body, key);
    expect(retry.status).toBe(200);
    expect(retry.json.idempotent).toBe(true);
    expect(retry.json.item.id).toBe(first.json.item.id);

    const facts = await stockFacts(first.json.item.id);
    expect(facts.items).toBe(1);
    expect(facts.movements).toBe(1);
    expect(Number(facts.moved)).toBe(20);
    expect(Number(facts.current_stock)).toBe(20);
    expect(Number(facts.opening_value)).toBe(160);
  });

  test('two saves with the same key at once still create one item', async () => {
    const key = randomUUID();
    const body = { name: `Maggi 70 g ${tag}`, barcode: '8901058000009', purchase_price: 12, opening_stock: 5 };
    const [a, b] = await Promise.all([create(body, key), create(body, key)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.json.item.id).toBe(b.json.item.id);
    expect((await stockFacts(a.json.item.id)).movements).toBe(1);
  });

  test('a key reused for a different product is refused', async () => {
    const key = randomUUID();
    expect((await create({ name: `Tata Salt ${tag}`, purchase_price: 20, opening_stock: 3 }, key)).status).toBe(201);
    const other = await create({ name: `Tata Salt ${tag}`, purchase_price: 20, opening_stock: 4 }, key);
    expect(other.status).toBe(409);
    expect(other.json.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  test('a save without a key works as before', async () => {
    const res = await create({ name: `No key item ${tag}`, purchase_price: 5, opening_stock: 2 });
    expect([res.status, res.json.error]).toEqual([201, undefined]);
    const facts = await stockFacts(res.json.item.id);
    expect(facts.movements).toBe(1);
    expect(Number(facts.current_stock)).toBe(2);
  });

  test('a barcode already in the shop is reported, not overwritten', async () => {
    const dup = await create({ name: `Another product ${tag}`, barcode: '0089012345675', purchase_price: 1, opening_stock: 1 }, randomUUID());
    expect(dup.status).toBe(400);

    const found = await lookup(' 0089012345675 ');
    expect(found.status).toBe(200);
    expect(found.json.match.item.name).toBe(`Parle-G 100 g ${tag}`);
    expect(found.json.match.has_history).toBe(false);
    expect(found.json.match.matched_variant_id).toBeNull();
  });

  test('leading zeroes matter: a shorter code is a different barcode', async () => {
    expect((await lookup('89012345675')).json.match).toBeNull();
  });

  test("another business never sees this shop's barcode", async () => {
    const res = await lookup('0089012345675', [OUSER, OTHER]);
    expect(res.status).toBe(200);
    expect(res.json.match).toBeNull();
  });

  test('an empty code is a bad request', async () => {
    expect((await lookup('')).status).toBe(400);
  });

  describe('product database lookup', () => {
    const HARPIC = '8901396151005';
    const realFetch = global.fetch;
    beforeAll(() => {
      global.fetch = providerFetch as unknown as typeof fetch;
    });
    afterAll(() => {
      global.fetch = realFetch;
    });
    beforeEach(() => {
      providerFetch.mockClear();
      resetProviderSlotsForTests();
    });

    async function externalLookup(code: string, as: [string, string] = [USER, B]) {
      const res = await getLookup(
        new NextRequest(`http://localhost/api/items/scan-add/lookup?code=${encodeURIComponent(code)}`, { headers: auth(as[0], as[1]) })
      );
      return { status: res.status, json: await res.json() };
    }

    test('a found barcode is suggested with its source, then answered from this shop’s cache', async () => {
      const first = await externalLookup(HARPIC);
      expect(first.status).toBe(200);
      expect(first.json.status).toBe('found');
      expect(first.json.suggestions[0]).toEqual(expect.objectContaining({ provider: 'productguru', quantity: '500 ml', attribution: 'Data: ProductGuru' }));
      expect(providerFetch).toHaveBeenCalledTimes(1);

      const again = await externalLookup(HARPIC);
      expect(again.json.cached).toBe(true);
      expect(providerFetch).toHaveBeenCalledTimes(1);
    });

    test("another shop's lookup does not use this shop's cache", async () => {
      const other = await externalLookup(HARPIC, [OUSER, OTHER]);
      expect(other.json.cached).toBe(false);
      expect(providerFetch).toHaveBeenCalledTimes(1);
      const rows = await pool.query(`SELECT business_id FROM product_lookup_cache WHERE barcode = $1 AND business_id = ANY($2::uuid[])`, [HARPIC, [B, OTHER]]);
      expect(rows.rows).toHaveLength(2);
    });

    test('a barcode nobody knows is cached as not found', async () => {
      const r = await externalLookup('8901058000009');
      expect(r.json.status).toBe('not_found');
      expect((await externalLookup('8901058000009')).json.cached).toBe(true);
    });

    test('accepting a suggestion records its source from the cache, not from the client', async () => {
      const saved = await create({ name: `Harpic 500 ml ${tag}`, barcode: HARPIC, purchase_price: 80, opening_stock: 6, lookup_source: 'productguru' }, randomUUID());
      expect([saved.status, saved.json.error]).toEqual([201, undefined]);
      const row = await pool.query(`SELECT external_source FROM items WHERE id = $1`, [saved.json.item.id]);
      expect(row.rows[0].external_source).toEqual(
        expect.objectContaining({ provider: 'productguru', source_url: `https://myproduct.guru/p/${HARPIC}`, license: 'CC BY 4.0' })
      );
    });

    test('a claimed source with nothing in the cache is ignored', async () => {
      const saved = await create({ name: `Hand typed ${tag}`, barcode: '8901058000016', purchase_price: 5, opening_stock: 1, lookup_source: 'productguru' }, randomUUID());
      expect([saved.status, saved.json.error]).toEqual([201, undefined]);
      const row = await pool.query(`SELECT external_source FROM items WHERE id = $1`, [saved.json.item.id]);
      expect(row.rows[0].external_source).toBeNull();
    });

    test('codes with odd characters are refused before any provider call', async () => {
      expect((await externalLookup('12;DROP')).status).toBe(400);
      expect(providerFetch).not.toHaveBeenCalled();
    });
  });

  describe('label photo reading', () => {
    async function read(form: FormData) {
      const res = await postReadLabel(new NextRequest('http://localhost/api/items/scan-add/read-label', { method: 'POST', headers: (({ 'content-type': _json, ...rest }) => rest)(auth(USER, B)), body: form }));
      return { status: res.status, json: await res.json() };
    }

    test('an unknown step or a missing photo is a bad request', async () => {
      const noStep = new FormData();
      noStep.append('image', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'a.jpg');
      expect((await read(noStep)).status).toBe(400);

      const noImage = new FormData();
      noImage.append('step', 'front');
      expect((await read(noImage)).status).toBe(400);
    });

    test('a file that is not a photo is refused', async () => {
      const pdf = new FormData();
      pdf.append('step', 'details');
      pdf.append('image', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }), 'a.pdf');
      expect((await read(pdf)).status).toBe(400);
    });
  });

  describe('batches, added stock and sizes', () => {
    const MAGGI = '8901058000023';
    const HARPIC = '8901396151012';
    let maggiId = '';
    let harpicId = '';

    async function send(handler: (r: NextRequest) => Promise<Response>, url: string, body: unknown, key?: string) {
      const res = await handler(
        new NextRequest(`http://localhost${url}`, {
          method: 'POST',
          headers: { ...auth(USER, B), ...(key ? { 'x-idempotency-key': key } : {}) },
          body: JSON.stringify(body),
        })
      );
      return { status: res.status, json: await res.json() };
    }

    async function openingValue(itemId: string): Promise<number> {
      const r = await pool.query(
        `SELECT COALESCE(SUM(debit), 0)::numeric AS v FROM ledger_entry_lines
          WHERE business_id = $1 AND voucher_id = $2 AND voucher_type = 'opening_stock'`,
        [B, itemId]
      );
      return Number(r.rows[0].v);
    }

    beforeAll(async () => {
      // Add stock uses inventory adjustments, which the plan must include.
      const plan = await pool.query(
        `SELECT plan_id FROM subscription_plan_features WHERE feature_id = 'purchase_inventory_adjustments' AND enabled ORDER BY plan_id LIMIT 1`
      );
      await pool.query(`UPDATE business_module_subscriptions SET plan_id = $2 WHERE business_id = $1`, [B, plan.rows[0].plan_id]);
    });

    test('opening stock with a batch goes into that batch and the item switches to FIFO batches', async () => {
      const saved = await create(
        {
          name: `Maggi 70 g ${tag}`,
          barcode: MAGGI,
          purchase_price: 11,
          opening_stock: 24,
          opening_batch: { batch_number: 'L45', manufacturing_date: '2026-09', expiry_date: '2027-03' },
        },
        randomUUID()
      );
      expect([saved.status, saved.json.error]).toEqual([201, undefined]);
      maggiId = saved.json.item.id;
      const item = await pool.query(`SELECT track_batch, valuation_method FROM items WHERE id = $1`, [maggiId]);
      expect(item.rows[0]).toEqual({ track_batch: true, valuation_method: 'fifo' });
      const batch = await pool.query(
        `SELECT batch_number, manufacturing_date::text AS mfg, expiry_date::text AS exp, quantity::numeric AS qty, purchase_price::numeric AS cost
           FROM item_batches WHERE item_id = $1`,
        [maggiId]
      );
      expect(batch.rows).toEqual([{ batch_number: 'L45', mfg: '2026-09-01', exp: '2027-03-31', qty: '24.000', cost: '11.00' }]);
      const move = await pool.query(`SELECT batch_id IS NOT NULL AS linked, unit_cost::numeric AS cost FROM stock_movements WHERE item_id = $1`, [maggiId]);
      expect(move.rows).toEqual([{ linked: true, cost: '11.00' }]);
      expect(await openingValue(maggiId)).toBe(264);
    });

    test('without a batch the item is created exactly as before', async () => {
      const saved = await create({ name: `Plain ${tag}`, purchase_price: 3, opening_stock: 4 }, randomUUID());
      const item = await pool.query(
        `SELECT COALESCE(track_batch, false) AS t, COALESCE(valuation_method, 'simple') AS v FROM items WHERE id = $1`,
        [saved.json.item.id]
      );
      expect(item.rows[0]).toEqual({ t: false, v: 'simple' });
      const move = await pool.query(`SELECT batch_id, unit_cost FROM stock_movements WHERE item_id = $1`, [saved.json.item.id]);
      expect(move.rows).toEqual([{ batch_id: null, unit_cost: null }]);
    });

    test('a bad batch date is refused before anything is saved', async () => {
      const bad = await create({ name: `Bad date ${tag}`, purchase_price: 3, opening_stock: 4, opening_batch: { expiry_date: '2027-02-30' } }, randomUUID());
      expect([bad.status, bad.json.code]).toEqual([400, 'INVALID_BATCH']);
    });

    test('added stock with a new batch makes a second batch; a retry adds nothing more', async () => {
      const key = randomUUID();
      const body = {
        adjustment_type: 'QUANTITY',
        item_id: maggiId,
        direction: 'INCREASE',
        quantity: 10,
        reason_code: 'STOCK_TAKE',
        adjustment_date: '2026-10-23',
        batch: { batch_number: 'L52', expiry_date: '2027-06' },
      };
      const first = await send(postAdjustment, '/api/inventory-adjustments', body, key);
      expect([first.status, first.json.error]).toEqual([201, undefined]);
      const retry = await send(postAdjustment, '/api/inventory-adjustments', body, key);
      expect([retry.status, retry.json.idempotent]).toEqual([200, true]);
      expect(retry.json.adjustment.adjustmentId).toBe(first.json.adjustment.adjustmentId);

      const reused = await send(postAdjustment, '/api/inventory-adjustments', { ...body, quantity: 11 }, key);
      expect([reused.status, reused.json.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);

      const batches = await pool.query(
        `SELECT batch_number, quantity::numeric AS q FROM item_batches WHERE item_id = $1 ORDER BY batch_number`,
        [maggiId]
      );
      expect(batches.rows).toEqual([
        { batch_number: 'L45', q: '24.000' },
        { batch_number: 'L52', q: '10.000' },
      ]);
      const adjustments = await pool.query(`SELECT COUNT(*)::int AS n FROM inventory_adjustments WHERE item_id = $1`, [maggiId]);
      expect(adjustments.rows[0].n).toBe(1);
      const item = await pool.query(`SELECT current_stock::numeric AS s FROM items WHERE id = $1`, [maggiId]);
      expect(Number(item.rows[0].s)).toBe(34);
    });

    test('an item that has had a stock change cannot be split into sizes', async () => {
      const r = await send(postVariant, '/api/items/scan-add/variant', { item_id: maggiId, variant_name: '140 g' }, randomUUID());
      expect([r.status, r.json.code]).toEqual([409, 'ITEM_HAS_HISTORY']);
      const item = await pool.query(`SELECT has_variants FROM items WHERE id = $1`, [maggiId]);
      expect(item.rows[0].has_variants).toBe(false);
    });

    test('a second size under the same barcode turns a fresh item into sizes, keeping its stock and value', async () => {
      const saved = await create(
        {
          name: `Harpic 500 ml ${tag}`,
          barcode: HARPIC,
          net_quantity: '500 ml',
          purchase_price: 80,
          selling_price: 99,
          opening_stock: 6,
          opening_batch: { batch_number: 'H1', expiry_date: '2028-01' },
        },
        randomUUID()
      );
      harpicId = saved.json.item.id;
      expect(await openingValue(harpicId)).toBe(480);

      const key = randomUUID();
      const body = {
        item_id: harpicId,
        variant_name: '200 ml',
        selling_price: 45,
        purchase_price: 36,
        opening_stock: 10,
        existing_variant_name: '500 ml',
        item_name: `Harpic ${tag}`,
        batch: { batch_number: 'H9', expiry_date: '2028-04' },
      };
      const first = await send(postVariant, '/api/items/scan-add/variant', body, key);
      expect([first.status, first.json.error, first.json.converted]).toEqual([201, undefined, true]);
      const retry = await send(postVariant, '/api/items/scan-add/variant', body, key);
      expect([retry.status, retry.json.variant_id]).toEqual([200, first.json.variant_id]);

      const item = await pool.query(
        `SELECT name, has_variants, opening_stock::numeric AS os, current_stock::numeric AS cs, net_quantity, barcode FROM items WHERE id = $1`,
        [harpicId]
      );
      expect(item.rows[0]).toEqual({ name: `Harpic ${tag}`, has_variants: true, os: '0.00', cs: '0.00', net_quantity: null, barcode: HARPIC });
      const vs = await pool.query(
        `SELECT v.variant_name, v.opening_stock::numeric AS os, v.current_stock::numeric AS cs, v.barcode,
                (SELECT string_agg(b.batch_number || ':' || b.quantity::int, ',') FROM item_batches b WHERE b.variant_id = v.id) AS batches
           FROM item_variants v WHERE v.item_id = $1 ORDER BY v.variant_name`,
        [harpicId]
      );
      expect(vs.rows).toEqual([
        { variant_name: '200 ml', os: '10.00', cs: '10.00', barcode: null, batches: 'H9:10' },
        { variant_name: '500 ml', os: '6.00', cs: '6.00', barcode: null, batches: 'H1:6' },
      ]);
      const itemLevelBatches = await pool.query(`SELECT COUNT(*)::int AS n FROM item_batches WHERE item_id = $1 AND variant_id IS NULL`, [harpicId]);
      expect(itemLevelBatches.rows[0].n).toBe(0);
      // 6 × 80 kept for the first pack, plus 10 × 36 for the new one.
      expect(await openingValue(harpicId)).toBe(840);

      const scanned = await lookup(HARPIC);
      expect(scanned.json.match.item.has_variants).toBe(true);
      expect(scanned.json.match.variants.map((v: { variant_name: string }) => v.variant_name)).toEqual(['200 ml', '500 ml']);
    });

    test('a size the item already has is refused; a new one is added', async () => {
      const dup = await send(postVariant, '/api/items/scan-add/variant', { item_id: harpicId, variant_name: '200 ML' }, randomUUID());
      expect([dup.status, dup.json.code]).toEqual([409, 'VARIANT_EXISTS']);
      const more = await send(postVariant, '/api/items/scan-add/variant', { item_id: harpicId, variant_name: '1 L', purchase_price: 150, opening_stock: 2 }, randomUUID());
      expect([more.status, more.json.converted]).toEqual([201, false]);
    });

    test('another business cannot add a size to this item', async () => {
      const res = await postVariant(
        new NextRequest('http://localhost/api/items/scan-add/variant', {
          method: 'POST',
          headers: auth(OUSER, OTHER),
          body: JSON.stringify({ item_id: harpicId, variant_name: '50 ml' }),
        })
      );
      expect(res.status).toBe(404);
    });
  });
});
