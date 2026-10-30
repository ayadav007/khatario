/**
 * A transfer between GSTINs closed short: the sender issues a credit note for the short part,
 * the receiver books only what arrived, and the inter-branch receivable and payable agree.
 * PHASE2_TEST_DATABASE_URL=postgresql://…/kh_phase2_test npx jest tests/db/inter-branch-shortfall.db.test.ts --runInBand
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { ensureInterBranchInvoiceForTransfer } from '@/lib/inter-branch-utils';
import { closeTransferShortfall } from '@/lib/stock-custody/transfer-shortfall';

const GSTIN_KA = '29AAAPL1234C1ZA';
const GSTIN_TN = '33ADVFS4469F1ZJ';

d('inter-branch transfer closed short (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const businessId = randomUUID();
  const blr = randomUUID();
  const hosur = randomUUID();
  const blrWh = randomUUID();
  const hosurWh = randomUUID();
  const itemId = randomUUID();
  const transferId = randomUUID();
  const tag = businessId.slice(0, 6);

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

  const balance = async (code: string, branch?: string) =>
    Number(
      (
        await pool.query(
          `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
            WHERE l.business_id = $1 AND a.account_code = $2 AND ($3::uuid IS NULL OR l.branch_id = $3)`,
          [businessId, code, branch ?? null]
        )
      ).rows[0].b
    );

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state, state_code, gst_registration_type) VALUES ($1, 'Twin State Co', $2, 'Karnataka', '29', 'regular')`,
      [businessId, GSTIN_KA]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [businessId]);
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
    await pool.query(`INSERT INTO location_stock (location_id, item_id, current_stock_qty) VALUES ($1, $2, 0)`, [blrWh, itemId]);
    await pool.query(
      `INSERT INTO stock_transfers (id, business_id, transfer_number, transfer_date, from_location_id, to_location_id, status)
       VALUES ($1, $2, $3, '2026-10-20', $4, $5, 'pending')`,
      [transferId, businessId, `ST-${tag}`, blrWh, hosurWh]
    );
    await pool.query(
      `INSERT INTO stock_transfer_items (transfer_id, item_id, qty, unit, quantity_requested, quantity_dispatched, received_qty, cost_snapshot)
       VALUES ($1, $2, 10, 'PCS', 10, 10, 6, 1000)`,
      [transferId, itemId]
    );
    await inTx((c) => ensureInterBranchInvoiceForTransfer(c, transferId));
    await pool.query(`UPDATE stock_transfers SET status = 'in_transit' WHERE id = $1`, [transferId]);
  });

  afterAll(async () => {
    const ids = [businessId];
    await pool.query('DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query('DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])', [ids]).catch(() => undefined);
    await pool.query(
      'DELETE FROM credit_note_items WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE business_id = $1)',
      [businessId]
    );
    await pool.query('DELETE FROM credit_notes WHERE business_id = $1', [businessId]);
    await pool.query('UPDATE stock_transfers SET inter_branch_invoice_id = NULL WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)', [businessId]);
    await pool.query('DELETE FROM invoices WHERE business_id = $1', [businessId]).catch(() => undefined);
    await closePool();
  });

  it('closes the short part with a credit note and books the receiver net', async () => {
    const result = await inTx((c) =>
      closeTransferShortfall(
        c,
        businessId,
        transferId,
        { date: '2026-10-25', lines: [{ item_id: itemId, qty: 4, reason: 'transit_loss' }] },
        null
      )
    );
    expect(result.completed).toBe(true);

    const inv = (
      await pool.query(`SELECT id, subtotal, igst_total, grand_total FROM invoices WHERE business_id = $1 AND document_type = 'inter_branch_invoice'`, [businessId])
    ).rows[0];
    expect(Number(inv.subtotal)).toBe(10000);
    expect(Number(inv.igst_total)).toBe(1800);

    const cn = (await pool.query(`SELECT * FROM credit_notes WHERE invoice_id = $1`, [inv.id])).rows;
    expect(cn).toHaveLength(1);
    expect(cn[0]).toMatchObject({ branch_id: blr, refund_status: 'adjusted' });
    expect(Number(cn[0].subtotal)).toBe(4000);
    expect(Number(cn[0].igst_total)).toBe(720);
    expect(Number(cn[0].grand_total)).toBe(4720);

    // Sender: receivable and sales net of the credit note; output IGST only on what arrived.
    expect(await balance('1109', blr)).toBe(7080);
    expect(await balance('4103', blr)).toBe(-6000);
    expect(await balance('2152', blr)).toBe(-1080);
    // Sender's stock: 10 went out at cost on the invoice, 4 came back on the credit note and were
    // written off as transit loss, so stock is credited once for 10 and COGS covers only the 6 sold.
    expect(await balance('1104', blr)).toBe(-10000);
    expect(await balance('5104', blr)).toBe(6000);
    // Receiver: ITC only on the 6 that arrived, those 6 enter its stock at the sender's cost
    // (perpetual: Inter-Branch Purchases moves straight to Inventory), payable mirrors the receivable.
    expect(await balance('5103', hosur)).toBe(0);
    expect(await balance('1104', hosur)).toBe(6000);
    expect(await balance('1112', hosur)).toBe(1080);
    expect(await balance('2111', hosur)).toBe(-7080);
    expect(await balance('1109') + (await balance('2111'))).toBe(0);
  });

  it('closing the same transfer again posts nothing more', async () => {
    await expect(
      inTx((c) =>
        closeTransferShortfall(
          c,
          businessId,
          transferId,
          { date: '2026-10-26', lines: [{ item_id: itemId, qty: 1, reason: 'transit_loss' }] },
          null
        )
      )
    ).rejects.toThrow(/Only a transfer in transit/);
  });
});
