import type { PoolClient } from 'pg';
import * as db from '@/lib/db';

type Queryable = Pick<PoolClient, 'query'>;

const round2 = (n: number) => Math.round(n * 100) / 100;

async function rows<T extends Record<string, unknown>>(
  client: Queryable | undefined,
  sql: string,
  params: unknown[]
): Promise<T[]> {
  if (client) return (await client.query<T>(sql, params)).rows;
  return db.queryRows<T>(sql, params);
}

export async function getInventoryModel(
  client: Queryable | undefined,
  businessId: string
): Promise<'periodic' | 'perpetual'> {
  const r = await rows<{ inventory_model: string | null }>(
    client,
    'SELECT inventory_model FROM business_settings WHERE business_id = $1',
    [businessId]
  );
  return r[0]?.inventory_model === 'periodic' ? 'periodic' : 'perpetual';
}

/**
 * Weighted-average unit cost per goods item as of a date (Ind AS 2 / AS 2):
 *   (opening qty × item purchase price + purchase taxable value to date) / (opening qty + purchased qty).
 * Falls back to the item's purchase price when it has no opening stock and no purchases.
 */
export async function weightedAverageCosts(
  client: Queryable | undefined,
  businessId: string,
  itemIds: string[],
  asOfDate: Date | string,
  /** Branches buy at different prices; when the branch has its own purchases of the item, cost from those. */
  branchId?: string | null
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (itemIds.length === 0) return result;
  const r = await rows<{ id: string; rate: string | null }>(
    client,
    `SELECT i.id,
            COALESCE(
              bp.value / NULLIF(bp.qty, 0),
              (COALESCE(i.opening_stock, 0) * COALESCE(i.opening_stock_rate, i.purchase_price, 0) + COALESCE(p.value, 0))
                / NULLIF(COALESCE(i.opening_stock, 0) + COALESCE(p.qty, 0), 0),
              i.purchase_price,
              0
            ) AS rate
       FROM items i
       LEFT JOIN (
         SELECT pi.item_id, SUM(pi.quantity) AS qty, SUM(pi.taxable_value) AS value
           FROM purchase_items pi
           JOIN purchases pu ON pu.id = pi.purchase_id
          WHERE pu.business_id = $1
            AND COALESCE(pu.status, '') NOT IN ('cancelled', 'draft')
            AND pu.bill_date <= $3::date
            AND pi.quantity > 0
            AND pi.taxable_value > 0
          GROUP BY pi.item_id
       ) p ON p.item_id = i.id
       LEFT JOIN (
         SELECT pi.item_id, SUM(pi.quantity) AS qty, SUM(pi.taxable_value) AS value
           FROM purchase_items pi
           JOIN purchases pu ON pu.id = pi.purchase_id
          WHERE pu.business_id = $1
            AND $4::uuid IS NOT NULL
            AND pu.branch_id = $4::uuid
            AND COALESCE(pu.status, '') NOT IN ('cancelled', 'draft')
            AND pu.bill_date <= $3::date
            AND pi.quantity > 0
            AND pi.taxable_value > 0
          GROUP BY pi.item_id
       ) bp ON bp.item_id = i.id
      WHERE i.business_id = $1 AND i.id = ANY($2::uuid[])`,
    [businessId, itemIds, asOfDate, branchId ?? null]
  );
  for (const row of r) result.set(row.id, Number(row.rate) || 0);
  return result;
}

/** Cost of the goods on the given lines; bundles are costed through their components, services cost nothing. */
export async function computeGoodsCost(
  client: Queryable | undefined,
  businessId: string,
  lines: Array<{ itemId: string | null | undefined; quantity: number }>,
  asOfDate: Date | string,
  branchId?: string | null
): Promise<number> {
  const ids = [...new Set(lines.map((l) => l.itemId).filter((id): id is string => !!id))];
  if (ids.length === 0) return 0;

  const items = await rows<{ id: string; item_type: string | null; is_bundle: boolean | null }>(
    client,
    `SELECT id, item_type, COALESCE(is_bundle, false) AS is_bundle FROM items WHERE business_id = $1 AND id = ANY($2::uuid[])`,
    [businessId, ids]
  );
  const meta = new Map(items.map((i) => [i.id, i]));

  const bundleIds = items.filter((i) => i.item_type === 'goods' && i.is_bundle).map((i) => i.id);
  const components = bundleIds.length
    ? await rows<{ bundle_id: string; item_id: string; quantity: string }>(
        client,
        'SELECT bundle_id, item_id, quantity FROM bundle_items WHERE bundle_id = ANY($1::uuid[])',
        [bundleIds]
      )
    : [];

  const qtyByItem = new Map<string, number>();
  const add = (id: string, q: number) => qtyByItem.set(id, (qtyByItem.get(id) ?? 0) + q);
  for (const line of lines) {
    if (!line.itemId) continue;
    const m = meta.get(line.itemId);
    if (!m || m.item_type !== 'goods') continue;
    if (m.is_bundle) {
      for (const c of components.filter((c) => c.bundle_id === line.itemId)) {
        add(c.item_id, (Number(c.quantity) || 0) * line.quantity);
      }
    } else {
      add(line.itemId, line.quantity);
    }
  }
  if (qtyByItem.size === 0) return 0;

  const rates = await weightedAverageCosts(client, businessId, [...qtyByItem.keys()], asOfDate, branchId);
  let total = 0;
  for (const [id, qty] of qtyByItem) total += qty * (rates.get(id) ?? 0);
  return round2(total);
}

/**
 * Perpetual inventory: moves cost between Inventory (1104) and COGS (5104) inside the
 * sale/return voucher, so cancelling that voucher reverses the cost too.
 * direction 'sale' = Dr COGS / Cr Inventory; 'return' = Dr Inventory / Cr COGS.
 */
export async function postCostOfGoods(
  client: Queryable,
  opts: {
    businessId: string;
    voucherType: string;
    voucherId: string;
    amount: number;
    entryDate: Date | string;
    reference: string;
    branchId?: string | null;
    direction: 'sale' | 'return';
  }
): Promise<boolean> {
  const amount = round2(opts.amount);
  if (amount <= 0) return false;

  const acc = await rows<{ account_code: string; id: string }>(
    client,
    `SELECT account_code, id FROM accounts
      WHERE business_id = $1 AND account_code IN ('1104', '5104') AND is_active = true`,
    [opts.businessId]
  );
  const inventory = acc.find((a) => a.account_code === '1104')?.id;
  const cogs = acc.find((a) => a.account_code === '5104')?.id;
  if (!inventory || !cogs) {
    throw new Error('Inventory (1104) or Cost of Goods Sold (5104) account is missing; run the chart-of-accounts seed.');
  }

  const sale = opts.direction === 'sale';
  const narration = sale
    ? `Cost of goods sold - ${opts.reference}`
    : `Cost of goods returned - ${opts.reference}`;
  for (const [accountId, debit, credit] of [
    [cogs, sale ? amount : 0, sale ? 0 : amount],
    [inventory, sale ? 0 : amount, sale ? amount : 0],
  ] as const) {
    await client.query(
      `INSERT INTO ledger_entry_lines (
         business_id, voucher_id, voucher_type, account_id, entry_date,
         debit, credit, narration, reference_number, branch_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [opts.businessId, opts.voucherId, opts.voucherType, accountId, opts.entryDate, debit, credit, narration, opts.reference, opts.branchId ?? null]
    );
  }
  return true;
}
