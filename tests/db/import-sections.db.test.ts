/**
 * Real-PostgreSQL test: the import sections' findExisting, saveRow and undoRecord.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 * Creates its own businesses (and one test plan) and removes only those.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

// enforceAccess reads the request headers; outside a route the test supplies the session ones.
const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __ssHeaders: typeof headerBag }).__ssHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __ssHeaders: { current: Record<string, string> } }).__ssHeaders.current[
        name.toLowerCase()
      ] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { SECTIONS } from '@/lib/import/sections';
import { findReferences, findReferencesMany } from '@/lib/import/record-usage';

// 27AAAPA1234A1ZT and 27BBBPB5678B1ZY carry correct check characters.
const GSTIN_A = '27AAAPA1234A1ZT';
const GSTIN_B = '27BBBPB5678B1ZY';
const PREFIX = 'Imp sections ';

d('import sections (real DB)', () => {
  jest.setTimeout(90000);

  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const TEST_PLAN = `test_import_${tag}`;

  type Biz = { id: string; branch: string; user: string; ctx: { businessId: string; userId: string } };
  const newBiz = (): Biz => {
    const id = randomUUID();
    const user = randomUUID();
    return { id, branch: randomUUID(), user, ctx: { businessId: id, userId: user } };
  };
  const A = newBiz(); // main business
  const O = newBiz(); // another business
  const L = newBiz(); // business on the test plan with a customer limit of 1

  const useSession = (b: Biz) => {
    headerBag.current = {
      'x-authenticated-user-id': b.user,
      'x-authenticated-business-id': b.id,
      'x-authenticated-session-version': '1',
    };
  };

  async function seedBusiness(b: Biz, planId: string, phonePrefix: string) {
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, $3, '27', 'regular', 'billing')`,
      [b.id, `${PREFIX}${tag} ${phonePrefix}`, GSTIN_A]
    );
    await pool.query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [b.id]
    );
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [b.id, planId]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [b.branch, b.id]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Admin', $3, true, 1, true)`,
      [b.user, b.id, `${phonePrefix}${Date.now().toString().slice(-8)}`]
    );
    // The opening stock ledger posts Dr Inventory (1104) / Cr Opening Balance Adjustment (3100).
    for (const [code, name, type, nature] of [
      ['1104', 'Inventory', 'asset', 'debit'],
      ['3100', 'Opening Balance Adjustment', 'equity', 'credit'],
    ]) {
      await pool.query(
        `INSERT INTO accounts (id, business_id, account_code, account_name, account_type, nature, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [randomUUID(), b.id, code, name, type, nature]
      );
    }
  }

  async function purge(businessIds: string[], planIds: string[]) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await withLedgerDelete(c, 'admin:seed_demo', null, async () => {
        await c.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [businessIds]);
        await c.query(`DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])`, [businessIds]);
      });
      for (const id of businessIds) {
        await c.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)`, [id]);
        await c.query(`DELETE FROM invoices WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM purchases WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM stock_movements WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM branch_item_stock WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM items WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM suppliers WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM activity_logs WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM accounts WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM account_groups WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await c.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
      // Features and limits of the test plan go with it (ON DELETE CASCADE).
      if (planIds.length) await c.query(`DELETE FROM subscription_plans WHERE id = ANY($1::text[])`, [planIds]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  const deletedAt = async (table: string, id: string) =>
    (await pool.query(`SELECT deleted_at FROM ${table} WHERE id = $1`, [id])).rows[0]?.deleted_at ?? null;

  async function addInvoice(b: Biz, customerId: string | null): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 'tax_invoice', $5)`,
      [id, b.id, customerId, `IMP-${randomUUID().slice(0, 8)}`, b.branch]
    );
    return id;
  }

  beforeAll(async () => {
    pool = getPool();
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE $1`, [`${PREFIX}%`]);
    const orphanPlans = await pool.query<{ id: string }>(`SELECT id FROM subscription_plans WHERE id LIKE 'test_import_%'`);
    if (orphans.rows.length || orphanPlans.rows.length) {
      await purge(orphans.rows.map((r) => r.id), orphanPlans.rows.map((r) => r.id));
    }
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN ('supplier_management', 'purchase_suppliers') LIMIT 1`
    );
    if (!plan.rows[0]) throw new Error('No plan grants supplier_management (or purchase_suppliers)');
    const planId = plan.rows[0].plan_id;

    // A copy of that plan whose only difference is a customer limit of 1.
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`CREATE TEMP TABLE tmp_plan ON COMMIT DROP AS SELECT * FROM subscription_plans WHERE id = $1`, [planId]);
      await c.query(`UPDATE tmp_plan SET id = $1, name = $1, display_name = $1, is_active = false`, [TEST_PLAN]);
      await c.query(`INSERT INTO subscription_plans SELECT * FROM tmp_plan`);
      await c.query(
        `INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
         SELECT $1, feature_id, enabled FROM subscription_plan_features WHERE plan_id = $2`,
        [TEST_PLAN, planId]
      );
      await c.query(
        `INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES ($1, 'max_customers', 1)`,
        [TEST_PLAN]
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }

    await seedBusiness(A, planId, '91');
    await seedBusiness(O, planId, '92');
    await seedBusiness(L, TEST_PLAN, '96');
    useSession(A);
  });

  afterAll(async () => {
    try {
      if (pool) await purge([A.id, O.id, L.id], [TEST_PLAN]);
    } finally {
      await closePool();
    }
  });

  describe('customers', () => {
    const def = SECTIONS.customers;
    let sharmaId = '';

    test('saveRow creates the customer through the service', async () => {
      useSession(A);
      const r = await def.saveRow(A.ctx, {
        name: 'Sharma Traders',
        gstin: GSTIN_A,
        phone: '9876543210',
        state: 'Maharashtra',
        credit_limit: 5000,
        credit_days: 30,
      });
      expect(r).toMatchObject({ ok: true, table: 'customers' });
      if (r.ok) sharmaId = r.id;
      const row = (await pool.query(`SELECT * FROM customers WHERE id = $1`, [sharmaId])).rows[0];
      expect(row).toMatchObject({ business_id: A.id, state_code: '27', credit_days: 30 });
      expect(Number(row.credit_limit)).toBe(5000);
    });

    test('findExisting matches by GSTIN, then phone, then name', async () => {
      expect(await def.findExisting(A.ctx, { name: 'Other', gstin: ' 27aaapa1234a1zt ' })).toEqual({
        id: sharmaId,
        label: 'Sharma Traders',
        matchedOn: 'GSTIN',
      });
      expect(await def.findExisting(A.ctx, { name: 'Other', gstin: GSTIN_B, phone: '+91 98765 43210' })).toMatchObject({
        id: sharmaId,
        matchedOn: 'phone',
      });
      expect(await def.findExisting(A.ctx, { name: '  sharma   TRADERS ', gstin: GSTIN_B })).toMatchObject({
        id: sharmaId,
        matchedOn: 'name',
      });
      expect(await def.findExisting(A.ctx, { name: 'Nobody', gstin: GSTIN_B })).toBeNull();
    });

    test('findExisting matches by email, trimmed and lower-cased, after phone and before name', async () => {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO customers (business_id, name, email) VALUES ($1, 'Mail Match', 'Accounts@MailMatch.in') RETURNING id`,
        [A.id]
      );
      expect(await def.findExisting(A.ctx, { name: 'Another Name', email: '  accounts@mailmatch.IN ' })).toEqual({
        id: row.rows[0].id,
        label: 'Mail Match',
        matchedOn: 'email',
      });
      // An inactive or deleted customer is not a match, as in the service's duplicate-email check.
      await pool.query(`UPDATE customers SET is_active = false WHERE id = $1`, [row.rows[0].id]);
      expect(await def.findExisting(A.ctx, { name: 'Another Name', email: 'accounts@mailmatch.in' })).toBeNull();
      await pool.query(`DELETE FROM customers WHERE id = $1`, [row.rows[0].id]);
    });

    test("another business's customer with the same GSTIN is not a match", async () => {
      expect(await def.findExisting(O.ctx, { name: 'Sharma Traders', gstin: GSTIN_A, phone: '919876543210' })).toBeNull();
    });

    test('a stored phone with a leading 0 is found by the +91 form under another name', async () => {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Zero Prefix', '08888877777') RETURNING id`,
        [A.id]
      );
      expect(await def.findExisting(A.ctx, { name: 'Different Name', phone: '+91 88888 77777' })).toEqual({
        id: row.rows[0].id,
        label: 'Zero Prefix',
        matchedOn: 'phone',
      });
    });

    test('a duplicate phone is answered as Already exists', async () => {
      const r = await def.saveRow(A.ctx, { name: 'Second Sharma', phone: '9876543210' });
      expect(r).toEqual({ ok: false, error: 'Already exists: Sharma Traders' });
    });

    test('a service refusal comes back as the error text', async () => {
      const r = await def.saveRow(A.ctx, { name: 'Wrong State', gstin: GSTIN_B, state: 'Karnataka' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/registered in Maharashtra/);
    });

    test('undoRecord on a customer with an invoice keeps it', async () => {
      await addInvoice(A, sharmaId);
      expect(await findReferences('customers', sharmaId)).toEqual(['invoices']);
      expect(await def.undoRecord(A.ctx, sharmaId)).toEqual({ ok: false, reason: 'Used in invoices' });
      expect(await deletedAt('customers', sharmaId)).toBeNull();
    });

    test('saveRow then undoRecord soft-deletes; findExisting no longer matches', async () => {
      const r = await def.saveRow(A.ctx, { name: 'Gupta Stores', phone: '9123456780' });
      if (!r.ok) throw new Error(r.error);
      expect(await def.undoRecord(A.ctx, r.id)).toEqual({ ok: true });
      expect(await deletedAt('customers', r.id)).not.toBeNull();
      expect(await def.findExisting(A.ctx, { name: 'Gupta Stores', phone: '919123456780' })).toBeNull();
    });

    test('undoRecord from another business does not touch the record', async () => {
      const r = await def.saveRow(A.ctx, { name: 'Kept Customer' });
      if (!r.ok) throw new Error(r.error);
      expect(await def.undoRecord(O.ctx, r.id)).toEqual({ ok: false, reason: 'Not found' });
      expect(await deletedAt('customers', r.id)).toBeNull();
    });

    test('a plan limit refusal is a row failure, not a thrown error', async () => {
      useSession(L);
      await pool.query(`INSERT INTO customers (business_id, name) VALUES ($1, 'Already Here')`, [L.id]);
      const r = await def.saveRow(L.ctx, { name: 'One Too Many' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/customers limit \(1\/1\)/);
      const n = await pool.query(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1`, [L.id]);
      expect(n.rows[0].n).toBe(1);
      useSession(A);
    });
  });

  describe('suppliers', () => {
    const def = SECTIONS.suppliers;
    let patilId = '';

    test('saveRow creates the supplier without writing an activity log', async () => {
      const r = await def.saveRow(A.ctx, { name: 'Patil Wholesale', gstin: GSTIN_A, phone: '919988776655', pan: null });
      expect(r).toMatchObject({ ok: true, table: 'suppliers' });
      if (r.ok) patilId = r.id;
      const logs = await pool.query(`SELECT COUNT(*)::int AS n FROM activity_logs WHERE business_id = $1 AND module = 'suppliers'`, [A.id]);
      expect(logs.rows[0].n).toBe(0);
    });

    test('findExisting matches by GSTIN, then phone, then name; not across businesses', async () => {
      expect(await def.findExisting(A.ctx, { name: 'X', gstin: GSTIN_A })).toEqual({
        id: patilId,
        label: 'Patil Wholesale',
        matchedOn: 'GSTIN',
      });
      expect(await def.findExisting(A.ctx, { name: 'X', gstin: GSTIN_B, phone: '9988776655' })).toMatchObject({
        id: patilId,
        matchedOn: 'phone',
      });
      expect(await def.findExisting(A.ctx, { name: 'PATIL wholesale' })).toMatchObject({ id: patilId, matchedOn: 'name' });
      expect(await def.findExisting(O.ctx, { name: 'Patil Wholesale', gstin: GSTIN_A })).toBeNull();
    });

    test('a stored phone with a leading 0 is found by the +91 form under another name', async () => {
      const row = await pool.query<{ id: string }>(
        `INSERT INTO suppliers (business_id, name, phone) VALUES ($1, 'Zero Supplier', '07777766666') RETURNING id`,
        [A.id]
      );
      expect(await def.findExisting(A.ctx, { name: 'Another Supplier', phone: '+91 77777 66666' })).toEqual({
        id: row.rows[0].id,
        label: 'Zero Supplier',
        matchedOn: 'phone',
      });
    });

    test('a duplicate GSTIN is answered as Already exists', async () => {
      expect(await def.saveRow(A.ctx, { name: 'Patil Again', gstin: GSTIN_A })).toEqual({
        ok: false,
        error: 'Already exists: Patil Wholesale',
      });
    });

    test('undoRecord on a supplier with a purchase keeps it', async () => {
      await pool.query(
        `INSERT INTO purchases (business_id, supplier_id, bill_number, bill_date, status, branch_id)
         VALUES ($1, $2, 'B-1', CURRENT_DATE, 'draft', $3)`,
        [A.id, patilId, A.branch]
      );
      expect(await def.undoRecord(A.ctx, patilId)).toEqual({ ok: false, reason: 'Used in purchases' });
      expect(await deletedAt('suppliers', patilId)).toBeNull();
    });

    test('saveRow then undoRecord soft-deletes; findExisting no longer matches', async () => {
      const r = await def.saveRow(A.ctx, { name: 'Joshi Agencies', gstin: GSTIN_B });
      if (!r.ok) throw new Error(r.error);
      expect(await def.undoRecord(A.ctx, r.id)).toEqual({ ok: true });
      expect(await deletedAt('suppliers', r.id)).not.toBeNull();
      expect(await def.findExisting(A.ctx, { name: 'Joshi Agencies', gstin: GSTIN_B })).toBeNull();
    });
  });

  describe('items', () => {
    const def = SECTIONS.items;
    let teaId = '';

    test('saveRow creates the item; a type containing "service" makes a service', async () => {
      const r = await def.saveRow(A.ctx, {
        name: 'Green Tea',
        code: 'GT-01',
        barcode: '8901234567890',
        unit: 'BOX',
        tax_rate: 5,
        selling_price: 120,
        item_type: 'Goods',
      });
      expect(r).toMatchObject({ ok: true, table: 'items' });
      if (r.ok) teaId = r.id;
      const s = await def.saveRow(A.ctx, { name: 'Repair', item_type: 'Services' });
      if (!s.ok) throw new Error(s.error);
      const types = await pool.query(`SELECT id, item_type, unit, tax_rate FROM items WHERE id = ANY($1::uuid[])`, [[teaId, s.id]]);
      const byId = Object.fromEntries(types.rows.map((row) => [row.id, row]));
      expect(byId[teaId]).toMatchObject({ item_type: 'goods', unit: 'BOX' });
      expect(Number(byId[teaId].tax_rate)).toBe(5);
      expect(byId[s.id].item_type).toBe('service');
    });

    test('findExisting matches by code, then barcode, then name; not across businesses', async () => {
      expect(await def.findExisting(A.ctx, { name: 'X', code: 'gt-01' })).toEqual({
        id: teaId,
        label: 'Green Tea',
        matchedOn: 'item code',
      });
      expect(await def.findExisting(A.ctx, { name: 'X', code: 'NOPE', barcode: '8901234567890' })).toMatchObject({
        id: teaId,
        matchedOn: 'barcode',
      });
      expect(await def.findExisting(A.ctx, { name: 'green  TEA', code: 'NOPE' })).toMatchObject({ id: teaId, matchedOn: 'name' });
      expect(await def.findExisting(O.ctx, { name: 'Green Tea', code: 'GT-01' })).toBeNull();
    });

    test('an item with opening stock is kept with the opening-stock reason', async () => {
      const r = await def.saveRow(A.ctx, { name: 'Rice 5kg', opening_stock: 5, purchase_price: 300 });
      if (!r.ok) throw new Error(r.error);
      expect(await def.undoRecord(A.ctx, r.id)).toEqual({
        ok: false,
        reason: 'Has opening stock. Delete it from the Items list if it is not needed.',
      });
      expect(await deletedAt('items', r.id)).toBeNull();
    });

    test('undoRecord on an item on an invoice keeps it', async () => {
      const invoiceId = await addInvoice(A, null);
      await pool.query(
        `INSERT INTO invoice_items (invoice_id, item_id, item_name, quantity, unit_price, line_total)
         VALUES ($1, $2, 'Green Tea', 1, 120, 120)`,
        [invoiceId, teaId]
      );
      expect(await def.undoRecord(A.ctx, teaId)).toEqual({ ok: false, reason: 'Used in invoice items' });
      expect(await deletedAt('items', teaId)).toBeNull();
    });

    test('saveRow then undoRecord soft-deletes; findExisting no longer matches', async () => {
      const r = await def.saveRow(A.ctx, { name: 'Sugar 1kg', code: 'SG-01' });
      if (!r.ok) throw new Error(r.error);
      expect(await def.undoRecord(A.ctx, r.id)).toEqual({ ok: true });
      expect(await deletedAt('items', r.id)).not.toBeNull();
      expect(await def.findExisting(A.ctx, { name: 'Sugar 1kg', code: 'SG-01' })).toBeNull();
    });

    test('undoRecords answers a mixed batch in input order and deletes only the unused', async () => {
      const save = async (values: Record<string, string | number>) => {
        const r = await def.saveRow(A.ctx, values);
        if (!r.ok) throw new Error(r.error);
        return r.id;
      };
      const unused1 = await save({ name: 'Batch Unused 1' });
      const unused2 = await save({ name: 'Batch Unused 2' });
      const stocked = await save({ name: 'Batch Stocked', opening_stock: 3 });
      const gone = await save({ name: 'Batch Gone' });
      expect(await def.undoRecord(A.ctx, gone)).toEqual({ ok: true });
      const goneAt = await deletedAt('items', gone);
      const foreign = (
        await pool.query<{ id: string }>(`INSERT INTO items (business_id, name) VALUES ($1, 'Foreign') RETURNING id`, [O.id])
      ).rows[0].id;

      const ids = [unused1, teaId, gone, foreign, stocked, 'not-a-uuid', unused2];
      expect(await def.undoRecords(A.ctx, ids)).toEqual([
        { id: unused1, ok: true },
        { id: teaId, ok: false, reason: 'Used in invoice items' },
        { id: gone, ok: true },
        { id: foreign, ok: false, reason: 'Not found' },
        { id: stocked, ok: false, reason: 'Has opening stock. Delete it from the Items list if it is not needed.' },
        { id: 'not-a-uuid', ok: false, reason: 'Not found' },
        { id: unused2, ok: true },
      ]);
      expect(await deletedAt('items', unused1)).not.toBeNull();
      expect(await deletedAt('items', unused2)).not.toBeNull();
      expect(await deletedAt('items', teaId)).toBeNull();
      expect(await deletedAt('items', stocked)).toBeNull();
      expect(await deletedAt('items', foreign)).toBeNull();
      expect(await deletedAt('items', gone)).toEqual(goneAt);
    });

    test('findReferencesMany gives the same answers as findReferences per id', async () => {
      const ids = (
        await pool.query<{ id: string }>(`SELECT id FROM items WHERE business_id = $1 ORDER BY name`, [A.id])
      ).rows.map((r) => r.id);
      const many = await findReferencesMany('items', ids);
      for (const id of ids) {
        const one = await findReferences('items', id);
        expect([id, many.get(id) ?? null]).toEqual([id, one[0] ?? null]);
      }
      expect(many.get(teaId)).toBe('invoice_items');
    });
  });
});
