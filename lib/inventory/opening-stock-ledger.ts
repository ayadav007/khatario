import { getPool } from '@/lib/db';
import {
  getFinancialYearStartDate,
  getOrCreateOpeningBalanceAdjustmentAccount,
} from '@/lib/ledger-utils';

/**
 * Opening stock of an item (and its variants) as a ledger voucher:
 *   Dr 1104 Inventory / Cr 3100 Opening Balance Adjustment, dated the FY start.
 * The rate is frozen in items.opening_stock_rate on first post so later purchase-price
 * edits do not revalue the opening. Re-running replaces the voucher (idempotent).
 */
export async function syncItemOpeningStockLedger(businessId: string, itemId: string): Promise<number> {
  const openingAccount = await getOrCreateOpeningBalanceAdjustmentAccount(businessId);
  const fyStart = await getFinancialYearStartDate(businessId);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const item = (
      await client.query<{ name: string; item_type: string; value: string }>(
        `UPDATE items
            SET opening_stock_rate = COALESCE(opening_stock_rate, purchase_price, 0)
          WHERE id = $1 AND business_id = $2
        RETURNING name, item_type,
                  (COALESCE(opening_stock, 0) * COALESCE(opening_stock_rate, purchase_price, 0)
                   + COALESCE((SELECT SUM(COALESCE(v.opening_stock, 0) * COALESCE(v.purchase_price, items.purchase_price, 0))
                                 FROM item_variants v WHERE v.item_id = items.id), 0))::numeric(14,2) AS value`,
        [itemId, businessId]
      )
    ).rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return 0;
    }

    const inventory = (
      await client.query<{ id: string }>(
        `SELECT id FROM accounts WHERE business_id = $1 AND account_code = '1104' AND is_active = true LIMIT 1`,
        [businessId]
      )
    ).rows[0];

    await client.query(
      `DELETE FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'opening_stock' AND voucher_id = $2`,
      [businessId, itemId]
    );

    const value = item.item_type === 'goods' ? Number(item.value) || 0 : 0;
    if (value > 0) {
      if (!inventory) throw new Error('Inventory account (1104) not found. Please set up chart of accounts.');
      const narration = `Opening stock - ${item.name}`.slice(0, 500);
      for (const [accountId, debit, credit] of [
        [inventory.id, value, 0],
        [openingAccount.id, 0, value],
      ] as const) {
        await client.query(
          `INSERT INTO ledger_entry_lines (
             business_id, voucher_id, voucher_type, account_id, entry_date,
             debit, credit, narration, reference_number, branch_id
           ) VALUES ($1, $2, 'opening_stock', $3, $4, $5, $6, $7, $8, NULL)`,
          [businessId, itemId, accountId, fyStart, debit, credit, narration, item.name.slice(0, 100)]
        );
      }
    }

    await client.query('COMMIT');
    return value;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
