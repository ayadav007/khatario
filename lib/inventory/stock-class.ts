import type { PoolClient } from 'pg';

/** Goods stay on Inventory unless the item is marked as a manufacturing stock. */
export const STOCK_CLASSES = ['trading', 'raw_material', 'wip', 'finished_goods'] as const;
export type StockClass = (typeof STOCK_CLASSES)[number];

export const INVENTORY_ACCOUNT_CODES = ['1104', '1160', '1161', '1162'] as const;

const ACCOUNT_BY_CLASS: Record<StockClass, string> = {
  trading: '1104',
  raw_material: '1160',
  wip: '1161',
  finished_goods: '1162',
};

export function parseStockClass(value: unknown): StockClass {
  return STOCK_CLASSES.includes(value as StockClass) ? (value as StockClass) : 'trading';
}

export function accountCodeForStockClass(value: unknown): string {
  return ACCOUNT_BY_CLASS[parseStockClass(value)];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Split `total` across stock classes in proportion to `weight`.
 * One class receives the whole total. The last class absorbs rounding.
 */
export function allocateByStockClass(
  weights: Array<{ stockClass: unknown; weight: number }>,
  total: number,
): Array<{ code: string; amount: number }> {
  const target = round2(total);
  const positive = weights.filter((w) => w.weight > 0);
  const sum = positive.reduce((s, w) => s + w.weight, 0);
  if (target <= 0) return [];
  if (positive.length === 0 || sum <= 0) return [{ code: '1104', amount: target }];
  if (positive.length === 1) return [{ code: accountCodeForStockClass(positive[0].stockClass), amount: target }];

  let allocated = 0;
  return positive
    .map((w, i) => {
      const code = accountCodeForStockClass(w.stockClass);
      if (i === positive.length - 1) return { code, amount: round2(target - allocated) };
      const amount = round2(target * (w.weight / sum));
      allocated = round2(allocated + amount);
      return { code, amount };
    })
    .filter((row) => row.amount > 0);
}

type Queryable = Pick<PoolClient, 'query'>;

/** Adds Raw material, Work in progress and Finished goods under current assets when missing. */
export async function ensureInventoryClassAccounts(client: Queryable, businessId: string): Promise<void> {
  await client.query(
    `INSERT INTO accounts (
       business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order
     )
     SELECT $1, v.code, v.name, 'asset', g.id, 'debit', true, v.sort
       FROM account_groups g
       CROSS JOIN (VALUES
         ('1160', 'Raw material', 60),
         ('1161', 'Work in progress', 61),
         ('1162', 'Finished goods', 62)
       ) AS v(code, name, sort)
      WHERE g.business_id = $1 AND g.group_code = '1100'
     ON CONFLICT (business_id, account_code) DO NOTHING`,
    [businessId],
  );
}

export async function accountIdForCode(client: Queryable, businessId: string, code: string): Promise<string | null> {
  if (code !== '1104') await ensureInventoryClassAccounts(client, businessId);
  const found = await client.query<{ id: string }>(
    `SELECT id FROM accounts
      WHERE business_id = $1 AND account_code = $2 AND is_active = true
      LIMIT 1`,
    [businessId, code],
  );
  return found.rows[0]?.id ?? null;
}
