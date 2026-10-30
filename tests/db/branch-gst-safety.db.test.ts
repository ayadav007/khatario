/**
 * Branch GST safety: note series per GSTIN (migration 449), the inter-branch customer is never a
 * shopper, and expenses take the branch registration's state.
 * PHASE2_TEST_DATABASE_URL=postgresql://…/kh_phase2_test npx jest tests/db/branch-gst-safety.db.test.ts --runInBand
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { assertCreditNoteNumberFree, nextCreditNoteNumber } from '@/lib/credit-notes/create-credit-note';
import { getOrCreateBranchCustomer } from '@/lib/inter-branch-utils';
import { loadExpenseSupplyStates } from '@/lib/accounting/expense-lines';
import { sameRegistration } from '@/lib/gst/registration';

const GSTIN_MH = '27AAAPL1234C1ZE';
const GSTIN_KA = '29AAAPL1234C1ZA';

d('branch GST safety (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const businessId = randomUUID();
  const hq = randomUUID(); // Maharashtra head office (business GSTIN)
  const shop = randomUUID(); // second Maharashtra shop, no GSTIN of its own
  const blr = randomUUID(); // Karnataka branch with its own GSTIN
  const customerId = randomUUID();
  const shopperId = randomUUID();

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      fs.readFileSync(path.join(__dirname, '../../database/migrations/449_note_series_per_gstin.sql'), 'utf8')
    );
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state, state_code, gst_registration_type)
       VALUES ($1, 'Two State Co', $2, 'Maharashtra', '27', 'regular')`,
      [businessId, GSTIN_MH]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, gstin, state, state_code, is_primary, is_default, is_active) VALUES
         ($1, $4, 'Pune HQ', NULL, 'Maharashtra', '27', true, true, true),
         ($2, $4, 'Nashik Shop', NULL, 'Maharashtra', '27', false, false, true),
         ($3, $4, 'Bengaluru', $5, 'Karnataka', '29', false, false, true)`,
      [hq, shop, blr, businessId, GSTIN_KA]
    );
    await pool.query(`INSERT INTO customers (id, business_id, name) VALUES ($1, $2, 'Buyer')`, [customerId, businessId]);
    // A khata / store shopper tagged to the Bengaluru branch.
    await pool.query(
      `INSERT INTO customers (id, business_id, branch_id, name, created_at) VALUES ($1, $2, $3, 'Walk-in Shopper', NOW() - INTERVAL '1 day')`,
      [shopperId, businessId, blr]
    );
    const note = (branch: string, num: string) =>
      pool.query(
        `INSERT INTO credit_notes (business_id, branch_id, customer_id, credit_note_number, credit_note_date)
         VALUES ($1, $2, $3, $4, '2026-10-01')`,
        [businessId, branch, customerId, num]
      );
    await note(hq, 'CN-001');
    await note(shop, 'CN-002');
    await note(blr, 'CN-001');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM credit_notes WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM customers WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM branches WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]);
    await closePool();
  });

  it('runs one credit note series per GSTIN', async () => {
    expect(await nextCreditNoteNumber(pool, businessId, shop)).toBe('CN-003');
    expect(await nextCreditNoteNumber(pool, businessId, blr)).toBe('CN-002');
  });

  it('rejects a number already used on the same GSTIN, even by another shop', async () => {
    await expect(assertCreditNoteNumberFree(pool, businessId, hq, 'cn-002')).rejects.toMatchObject({
      code: 'DUPLICATE_CREDIT_NOTE_NUMBER',
    });
    await expect(assertCreditNoteNumberFree(pool, businessId, blr, 'CN-002')).resolves.toBeUndefined();
  });

  it('keeps note numbers unique per branch in the database', async () => {
    await expect(
      pool.query(
        `INSERT INTO credit_notes (business_id, branch_id, customer_id, credit_note_number, credit_note_date)
         VALUES ($1, $2, $3, 'CN-001', '2026-10-02')`,
        [businessId, hq, customerId]
      )
    ).rejects.toThrow(/uq_credit_notes_branch_number/);
  });

  it('knows which branches share a GSTIN', async () => {
    expect(await sameRegistration(pool, businessId, hq, shop)).toBe(true);
    expect(await sameRegistration(pool, businessId, hq, blr)).toBe(false);
  });

  it('never picks a shopper as the inter-branch customer', async () => {
    const id = await getOrCreateBranchCustomer(businessId, blr);
    expect(id).not.toBe(shopperId);
    const row = (await pool.query('SELECT customer_type, gstin FROM customers WHERE id = $1', [id])).rows[0];
    expect(row).toEqual({ customer_type: 'branch', gstin: GSTIN_KA });
    expect(await getOrCreateBranchCustomer(businessId, blr)).toBe(id);
  });

  it('decides the expense tax split from the branch registration, not the head office', async () => {
    const atBlr = await loadExpenseSupplyStates(businessId, null, GSTIN_KA, blr);
    expect(atBlr).toEqual({ businessState: '29', supplierState: '29' });
    const atHq = await loadExpenseSupplyStates(businessId, null, GSTIN_KA, hq);
    expect(atHq.businessState).toBe('27');
  });
});
