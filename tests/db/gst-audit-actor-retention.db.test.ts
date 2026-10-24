/**
 * User deletion keeps GST audit rows and their actor snapshot.
 * PHASE2_TEST_DATABASE_URL=postgresql://…/kh_phase2_test npx jest tests/db/gst-audit-actor-retention.db.test.ts --runInBand
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';

d('GST audit rows survive user deletion (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const businessId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const supplierId = randomUUID();
  const tag = businessId.slice(0, 8);

  const migration = fs.readFileSync(
    path.join(__dirname, '../../database/migrations/398_gst_audit_actor_retention.sql'),
    'utf8'
  );
  const rcmMigration = fs.readFileSync(
    path.join(__dirname, '../../database/migrations/399_gst_rcm_rule_conditions.sql'),
    'utf8'
  );

  beforeAll(async () => {
    pool = getPool();
    await pool.query(migration);
    await pool.query(migration);
    await pool.query(rcmMigration);
    await pool.query(rcmMigration);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular')`,
      [businessId, `GstActor ${tag}`, `27${tag.toUpperCase().padEnd(10, 'A').slice(0, 10)}1Z5`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [branchId, businessId]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1, $2, 'Audit Clerk', $3, false)`,
      [userId, businessId, `97${Date.now().toString().slice(-8)}`]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name) VALUES ($1, $2, 'Supplier')`,
      [supplierId, businessId]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', userId, async () => {
        await client.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
      });
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => {});
    } finally {
      client.release();
      await closePool();
    }
  });

  it('keeps the override and the acknowledgement after the user and the purchase are deleted', async () => {
    const approved = await pool.query(`SELECT COUNT(*)::int AS n FROM gst_rcm_rules WHERE status = 'approved'`);
    expect(approved.rows[0].n).toBe(0);
    const probe = randomUUID();
    await pool.query(
      `INSERT INTO gst_rcm_rules (id, catalogue_version, effective_from, supplier_type, source_citation, rule_key, exclusions)
       VALUES ($1, 0, '2017-07-01', 'either', 'unapproved probe', 'probe-not-active', '["example exclusion"]')`,
      [probe]
    );
    const stored = await pool.query(`SELECT status FROM gst_rcm_rules WHERE id = $1`, [probe]);
    expect(stored.rows[0].status).toBe('candidate');
    await pool.query(`DELETE FROM gst_rcm_rules WHERE id = $1`, [probe]);

    const action = await pool.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conname IN ('purchase_duplicate_overrides_created_by_fkey', 'gst_return_acknowledgements_user_id_fkey')
        ORDER BY conname`
    );
    expect(action.rows.map((row) => row.confdeltype)).toEqual(['n', 'n']);

    const existingId = randomUUID();
    const purchaseId = randomUUID();
    await pool.query(
      `INSERT INTO purchases (id, business_id, branch_id, supplier_id, bill_number, bill_date, status, grand_total, paid_amount, balance_amount, payment_status)
       VALUES ($1, $2, $3, $4, 'OLD-BILL', '2026-04-01', 'draft', 100, 0, 100, 'unpaid'),
              ($5, $2, $3, $4, 'NEW-BILL', '2026-04-02', 'draft', 100, 0, 100, 'unpaid')`,
      [existingId, businessId, branchId, supplierId, purchaseId]
    );
    const overrideId = randomUUID();
    await pool.query(
      `INSERT INTO purchase_duplicate_overrides (
         id, business_id, purchase_id, existing_purchase_id, reason, created_by,
         purchase_bill_number, purchase_bill_date, existing_bill_number, existing_bill_date, supplier_name,
         created_by_name, created_by_phone
       ) VALUES ($1, $2, $3, $4, 'second copy accepted', $5, 'NEW-BILL', '2026-04-02', 'OLD-BILL', '2026-04-01', 'Supplier', 'Audit Clerk', '9700000000')`,
      [overrideId, businessId, purchaseId, existingId, userId]
    );
    const ackId = randomUUID();
    await pool.query(
      `INSERT INTO gst_return_acknowledgements (
         id, business_id, kind, period_key, snapshot_id, issue_key, facts, amounts, user_id, user_name, user_phone
       ) VALUES ($1, $2, 'gstr1', '2026-04', 'snap-1', 'period:gstr1:2026-04:stale', '{"source":"books"}', '{"igst":0}', $3, 'Audit Clerk', '9700000000')`,
      [ackId, businessId, userId]
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    const override = await pool.query(
      `SELECT created_by, created_by_name, reason, purchase_bill_number FROM purchase_duplicate_overrides WHERE id = $1`,
      [overrideId]
    );
    expect(override.rows[0]).toEqual({
      created_by: null,
      created_by_name: 'Audit Clerk',
      reason: 'second copy accepted',
      purchase_bill_number: 'NEW-BILL',
    });
    const ack = await pool.query(
      `SELECT user_id, user_name, issue_key, period_key, facts FROM gst_return_acknowledgements WHERE id = $1`,
      [ackId]
    );
    expect(ack.rows[0].user_id).toBeNull();
    expect(ack.rows[0].user_name).toBe('Audit Clerk');
    expect(ack.rows[0].issue_key).toBe('period:gstr1:2026-04:stale');
    expect(ack.rows[0].period_key).toBe('2026-04');

    await pool.query(`DELETE FROM purchases WHERE id = $1`, [purchaseId]);
    const survived = await pool.query(
      `SELECT purchase_id, purchase_bill_number, existing_bill_number, reason, created_by_name
         FROM purchase_duplicate_overrides WHERE id = $1`,
      [overrideId]
    );
    expect(survived.rows[0]).toEqual({
      purchase_id: null,
      purchase_bill_number: 'NEW-BILL',
      existing_bill_number: 'OLD-BILL',
      reason: 'second copy accepted',
      created_by_name: 'Audit Clerk',
    });
    const ackStill = await pool.query(`SELECT id FROM gst_return_acknowledgements WHERE id = $1`, [ackId]);
    expect(ackStill.rows).toHaveLength(1);
  });
});
