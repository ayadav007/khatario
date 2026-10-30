/**
 * Inter-branch invoice raised for the dispatched quantity, and settlement of the inter-branch
 * receivable/payable between the two branches (migration 451).
 * PHASE2_TEST_DATABASE_URL=postgresql://…/kh_phase2_test npx jest tests/db/inter-branch-settlement.db.test.ts --runInBand
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { ensureInterBranchInvoiceForTransfer, postInterBranchReceiptForTransfer } from '@/lib/inter-branch-utils';
import {
  interBranchBalances,
  reverseInterBranchSettlement,
  settleInterBranchBalance,
} from '@/lib/accounting/inter-branch-settlement';

const GSTIN_KA = '29AAAPL1234C1ZA';
const GSTIN_TN = '33ADVFS4469F1ZJ';

d('inter-branch invoice at dispatch and settlement (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const businessId = randomUUID();
  const userId = randomUUID();
  const blr = randomUUID();
  const hosur = randomUUID();
  const blrWh = randomUUID();
  const hosurWh = randomUUID();
  const itemId = randomUUID();
  const transferId = randomUUID();
  const tag = businessId.slice(0, 6);
  let cash = '';
  let bank = '';

  async function inTx<T>(fn: (c: any) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  const balance = async (code: string, branch: string) =>
    Number(
      (
        await pool.query(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
            WHERE l.business_id = $1 AND a.account_code = $2 AND l.branch_id = $3`,
          [businessId, code, branch]
        )
      ).rows[0].b
    );

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      fs.readFileSync(path.join(__dirname, '../../database/migrations/451_inter_branch_settlements.sql'), 'utf8')
    );
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state, state_code, gst_registration_type) VALUES ($1, 'Settle Co', $2, 'Karnataka', '29', 'regular')`,
      [businessId, GSTIN_KA]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [businessId]);
    await pool.query(`INSERT INTO users (id, business_id, name, phone) VALUES ($1, $2, 'Accountant', $3)`, [
      userId,
      businessId,
      `98${Date.now().toString().slice(-8)}`,
    ]);
    await pool.query(
      `INSERT INTO branches (id, business_id, name, gstin, state, state_code, is_primary, is_default, is_active) VALUES
         ($1, $3, 'Bengaluru', NULL, 'Karnataka', '29', true, true, true),
         ($2, $3, 'Hosur', $4, 'Tamil Nadu', '33', false, false, true)`,
      [blr, hosur, businessId, GSTIN_TN]
    );
    await pool.query(
      `INSERT INTO warehouses (id, business_id, branch_id, name, state) VALUES
         ($1, $3, $4, 'Bengaluru Godown', 'Karnataka'), ($2, $3, $5, 'Hosur Godown', 'Tamil Nadu')`,
      [blrWh, hosurWh, businessId, blr, hosur]
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, hsn_sac, tax_rate, purchase_price, unit, item_type)
       VALUES ($1, $2, 'Steel Rack', '9403', 18, 1000, 'PCS', 'goods')`,
      [itemId, businessId]
    );
    // Requested 10, only 8 dispatched.
    await pool.query(
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, from_location_id, to_location_id, status)
       VALUES ($1, $2, $3, '2026-10-20', $4, $5, 'in_transit')`,
      [transferId, businessId, `ST-${tag}`, blrWh, hosurWh]
    );
    await pool.query(
      `INSERT INTO stock_transfer_items (transfer_id, item_id, qty, unit, quantity_requested, quantity_dispatched, received_qty, cost_snapshot)
       VALUES ($1, $2, 10, 'PCS', 10, 8, 8, 1000)`,
      [transferId, itemId]
    );
    const accts = await pool.query(
      `SELECT account_code, id FROM accounts WHERE business_id = $1 AND account_code IN ('1101', '1102')`,
      [businessId]
    );
    cash = accts.rows.find((r) => r.account_code === '1101').id;
    bank = accts.rows.find((r) => r.account_code === '1102').id;
  });

  afterAll(async () => {
    await closePool();
  });

  it('raises the inter-branch invoice for the dispatched quantity, dated at dispatch', async () => {
    const id = await inTx((c) => ensureInterBranchInvoiceForTransfer(c, transferId, { invoiceDate: '2026-10-22' }));
    const inv = (
      await pool.query(
        `SELECT i.invoice_date::text AS invoice_date, i.subtotal, i.grand_total, ii.quantity
           FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id WHERE i.id = $1`,
        [id]
      )
    ).rows[0];
    expect(inv.invoice_date).toBe('2026-10-22');
    expect(Number(inv.quantity)).toBe(8);
    expect(Number(inv.subtotal)).toBe(8000);
    expect(Number(inv.grand_total)).toBe(9440);
  });

  it('shows nothing to settle until the receiving branch has booked the invoice', async () => {
    expect((await interBranchBalances(pool, businessId)).filter((b) => b.open > 0)).toEqual([]);
    await inTx((c) => postInterBranchReceiptForTransfer(c, transferId));
    const [b] = await interBranchBalances(pool, businessId);
    expect(b).toMatchObject({ payer_branch_id: hosur, payee_branch_id: blr, invoiced: 9440, settled: 0, open: 9440 });
  });

  it('settles part by payment: each branch moves its own bank and inter-branch account', async () => {
    const s = await inTx((c) =>
      settleInterBranchBalance(c, {
        businessId, userId, payerBranchId: hosur, payeeBranchId: blr, mode: 'payment',
        amount: 4000, date: '2026-10-28', payerAccountId: bank, payeeAccountId: cash, reference: 'UTR123',
      })
    );
    expect(s.id).toBeTruthy();
    expect(await balance('2111', hosur)).toBe(-5440);
    expect(await balance('1102', hosur)).toBe(-4000);
    expect(await balance('1109', blr)).toBe(5440);
    expect(await balance('1101', blr)).toBe(4000);
    expect((await interBranchBalances(pool, businessId))[0].open).toBe(5440);

    // Cannot settle more than is open, nor net when nothing is owed the other way.
    await expect(
      inTx((c) =>
        settleInterBranchBalance(c, {
          businessId, userId, payerBranchId: hosur, payeeBranchId: blr, mode: 'payment',
          amount: 6000, date: '2026-10-28', payerAccountId: bank, payeeAccountId: cash,
        })
      )
    ).rejects.toMatchObject({ code: 'MORE_THAN_OPEN' });
    await expect(
      inTx((c) =>
        settleInterBranchBalance(c, {
          businessId, userId, payerBranchId: hosur, payeeBranchId: blr, mode: 'netting', amount: 100, date: '2026-10-28',
        })
      )
    ).rejects.toMatchObject({ code: 'MORE_THAN_OPEN' });

    // Reversing reopens it and restores both branches' books.
    await inTx((c) => reverseInterBranchSettlement(c, { businessId, settlementId: s.id, userId, date: '2026-10-29' }));
    expect(await balance('2111', hosur)).toBe(-9440);
    expect(await balance('1109', blr)).toBe(9440);
    expect((await interBranchBalances(pool, businessId))[0].open).toBe(9440);
  });
});
