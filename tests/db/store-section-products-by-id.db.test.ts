/**
 * Sections asking for products by id against real PostgreSQL: one query for the page, hidden products
 * absent, other businesses' products absent. Runs only when PHASE2_TEST_DATABASE_URL points at a
 * disposable database with migration 458 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import { resolveSectionData } from '@/lib/store/engine/section-data';
import type { SectionDataRequest } from '@/lib/store/engine/schema-types';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';

d('Section products by id (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const OTHER_BIZ = randomUUID();
  const A = randomUUID(); // shown in the store
  const B = randomUUID(); // shown in the store
  const H = randomUUID(); // hidden from the store
  const X = randomUUID(); // another business's product

  const ctxFor = (businessId: string) => ({ business_id: businessId, store_subdomain: 'by-id-test' }) as StoreBusinessContext;

  async function insertItem(id: string, businessId: string, name: string, shown: boolean) {
    await pool.query(
      `INSERT INTO items (id, business_id, name, unit, purchase_price, selling_price, tax_rate, show_in_store)
       VALUES ($1, $2, $3, 'PCS', 50, 100, 5, $4)`,
      [id, businessId, name, shown],
    );
  }

  beforeAll(async () => {
    pool = getPool();
    for (const [id, name] of [[BIZ, 'By id test'], [OTHER_BIZ, 'By id other']]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '29AAAPA1234A1Z5', '29', 'regular')`,
        [id, name],
      );
    }
    await insertItem(A, BIZ, 'Alpha', true);
    await insertItem(B, BIZ, 'Bravo', true);
    await insertItem(H, BIZ, 'Hidden', false);
    await insertItem(X, OTHER_BIZ, 'Foreign', true);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM items WHERE business_id = ANY($1::uuid[])`, [[BIZ, OTHER_BIZ]]);
    await pool.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[BIZ, OTHER_BIZ]]);
    await closePool();
  });

  it('one query, hidden products absent, business scoped', async () => {
    const out = await resolveSectionData(ctxFor(BIZ), new Map<string, SectionDataRequest>([['s1', { productIds: [A, H, X] }]]));
    expect(out.s1.error).toBeUndefined();
    expect(Object.keys(out.s1.productsById!)).toEqual([A]);
    expect(out.s1.productsById![A].name).toBe('Alpha');
  });

  it('gives each section its own ids in its own order', async () => {
    const out = await resolveSectionData(
      ctxFor(BIZ),
      new Map<string, SectionDataRequest>([
        ['s1', { productIds: [B, A] }],
        ['s2', { productIds: [A, H] }],
      ]),
    );
    expect(Object.keys(out.s1.productsById!)).toEqual([B, A]);
    expect(Object.keys(out.s2.productsById!)).toEqual([A]);
  });
});
