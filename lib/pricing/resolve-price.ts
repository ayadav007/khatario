import type { PoolClient } from 'pg';

/**
 * Which selling price a customer gets for an item, the way Tally/Busy/Vyapar pick it:
 *   1. a price typed by hand on the bill (the screens never ask for one then)
 *   2. the customer's own price for the item or variant
 *   3. the customer's price level (Wholesale, Dealer...), with quantity slabs
 *   4. the item's (or variant's) own selling price
 * A discount % comes from the customer's item rule, else the customer's category discount, else
 * the level rate. Rules only count on the bill date when they have a date range. All prices are on
 * the item's own GST basis (`items.gst_included`); screens convert to the bill's basis.
 */

export interface PriceRule {
  price: number | null;
  discount_percent: number | null;
  variant_id: string | null;
  min_qty?: number;
  valid_from: string | null;
  valid_to: string | null;
}

export type PriceSource = 'party' | 'level' | 'catalog';

export interface ResolvedPrice {
  price: number | null;
  priceSource: PriceSource;
  discountPercent: number | null;
  discountSource: 'party' | 'category' | 'level' | null;
  levelName: string | null;
}

const ymd = (d: string | null) => (d ? String(d).slice(0, 10) : null);

/**
 * The rule that applies on `date` for `qty`: a variant's own rule beats an item-wide one, a
 * bigger quantity slab (still within qty) beats a smaller one, a later start date beats an earlier.
 */
export function pickRule<T extends PriceRule>(
  rules: T[],
  opts: { variantId?: string | null; qty?: number; date: string }
): T | null {
  const qty = Number(opts.qty ?? 1) || 0;
  const date = ymd(opts.date)!;
  let best: T | null = null;
  const score = (r: T) => [r.variant_id ? 1 : 0, Number(r.min_qty ?? 0), ymd(r.valid_from) ?? ''] as const;
  for (const r of rules) {
    if (r.variant_id && r.variant_id !== (opts.variantId ?? null)) continue;
    if (Number(r.min_qty ?? 0) > qty) continue;
    const from = ymd(r.valid_from);
    const to = ymd(r.valid_to);
    if (from && from > date) continue;
    if (to && to < date) continue;
    if (!best) {
      best = r;
      continue;
    }
    const [av, aq, af] = score(r);
    const [bv, bq, bf] = score(best);
    if (av !== bv ? av > bv : aq !== bq ? aq > bq : af > bf) best = r;
  }
  return best;
}

export function resolveFromRules(input: {
  catalogPrice: number | null;
  partyRule: PriceRule | null;
  levelRule: PriceRule | null;
  levelName?: string | null;
  categoryDiscount: number | null;
}): ResolvedPrice {
  const { catalogPrice, partyRule, levelRule, categoryDiscount } = input;
  let price: number | null;
  let priceSource: PriceSource;
  if (partyRule?.price != null) {
    price = Number(partyRule.price);
    priceSource = 'party';
  } else if (levelRule?.price != null) {
    price = Number(levelRule.price);
    priceSource = 'level';
  } else {
    price = catalogPrice;
    priceSource = 'catalog';
  }

  let discountPercent: number | null = null;
  let discountSource: ResolvedPrice['discountSource'] = null;
  if (partyRule?.discount_percent != null) {
    discountPercent = Number(partyRule.discount_percent);
    discountSource = 'party';
  } else if (categoryDiscount != null) {
    discountPercent = Number(categoryDiscount);
    discountSource = 'category';
  } else if (levelRule?.discount_percent != null && priceSource !== 'party') {
    discountPercent = Number(levelRule.discount_percent);
    discountSource = 'level';
  }

  const levelUsed = priceSource === 'level' || discountSource === 'level';
  return { price, priceSource, discountPercent, discountSource, levelName: levelUsed ? input.levelName ?? null : null };
}

type Queryable = Pick<PoolClient, 'query'>;

export interface PriceLineInput {
  itemId: string;
  variantId?: string | null;
  qty?: number;
}

export interface PriceLineResult extends ResolvedPrice {
  itemId: string;
  variantId: string | null;
  /** Selling price from the item master (variant's when the line is a variant). */
  catalogPrice: number | null;
  gstIncluded: boolean;
  taxRate: number;
  /** Purchase price, on the item's GST basis, for the below-cost warning. */
  costPrice: number | null;
  mrp: number | null;
  lastSale: LastRate | null;
}

export interface LastRate {
  /** Pre-GST unit price on that bill, before line discount. */
  exclusivePrice: number;
  discountPercent: number;
  date: string;
  documentNumber: string | null;
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v));

/**
 * Prices for several lines of one bill. `customerId` null means a cash sale: catalog prices only.
 * Missing items come back with null prices rather than throwing, so a screen can keep going.
 */
export async function resolvePrices(
  db: Queryable,
  businessId: string,
  customerId: string | null,
  lines: PriceLineInput[],
  date: string
): Promise<PriceLineResult[]> {
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter(Boolean))];
  if (itemIds.length === 0) return [];

  const items = new Map<string, any>();
  for (const r of (
    await db.query(
      `SELECT id, selling_price, purchase_price, mrp, tax_rate, COALESCE(gst_included, false) AS gst_included, category_id
         FROM items WHERE business_id = $1 AND id = ANY($2::uuid[])`,
      [businessId, itemIds]
    )
  ).rows) {
    items.set(r.id, r);
  }
  const variants = new Map<string, any>();
  const variantIds = [...new Set(lines.map((l) => l.variantId).filter(Boolean))] as string[];
  if (variantIds.length) {
    for (const r of (
      await db.query(
        `SELECT v.id, v.item_id, v.selling_price, v.purchase_price
           FROM item_variants v JOIN items i ON i.id = v.item_id
          WHERE i.business_id = $1 AND v.id = ANY($2::uuid[])`,
        [businessId, variantIds]
      )
    ).rows) {
      variants.set(r.id, r);
    }
  }

  let partyRules: any[] = [];
  let levelRules: any[] = [];
  let levelName: string | null = null;
  const categoryDiscounts = new Map<string, any[]>();
  const lastSales = new Map<string, LastRate>();

  if (customerId) {
    const cust = (
      await db.query(
        `SELECT c.id, pl.id AS level_id, pl.name AS level_name
           FROM customers c
           LEFT JOIN price_levels pl ON pl.id = c.price_level_id AND pl.business_id = c.business_id AND pl.is_active = true
          WHERE c.id = $1 AND c.business_id = $2`,
        [customerId, businessId]
      )
    ).rows[0];
    if (cust) {
      partyRules = (
        await db.query(
          `SELECT item_id, variant_id, price::float AS price, discount_percent::float AS discount_percent,
                  valid_from::text AS valid_from, valid_to::text AS valid_to
             FROM party_item_prices
            WHERE business_id = $1 AND party_id = $2 AND item_id = ANY($3::uuid[])`,
          [businessId, customerId, itemIds]
        )
      ).rows;
      if (cust.level_id) {
        levelName = cust.level_name;
        levelRules = (
          await db.query(
            `SELECT item_id, variant_id, min_qty::float AS min_qty, price::float AS price,
                    discount_percent::float AS discount_percent, valid_from::text AS valid_from, valid_to::text AS valid_to
               FROM price_level_rates
              WHERE business_id = $1 AND price_level_id = $2 AND item_id = ANY($3::uuid[])`,
            [businessId, cust.level_id, itemIds]
          )
        ).rows;
      }
      for (const r of (
        await db.query(
          `SELECT category_id, discount_percent::float AS discount_percent,
                  valid_from::text AS valid_from, valid_to::text AS valid_to
             FROM party_category_discounts WHERE business_id = $1 AND party_id = $2`,
          [businessId, customerId]
        )
      ).rows) {
        const list = categoryDiscounts.get(r.category_id) ?? [];
        list.push({ ...r, price: null, variant_id: null });
        categoryDiscounts.set(r.category_id, list);
      }
      // Last rate charged to this customer per item (and variant), from final bills.
      for (const r of (
        await db.query(
          `SELECT DISTINCT ON (ii.item_id, ii.variant_id)
                  ii.item_id, ii.variant_id, ii.unit_price::float AS unit_price, ii.tax_rate::float AS tax_rate,
                  COALESCE(ii.discount_percent, 0)::float AS discount_percent,
                  COALESCE(inv.prices_include_gst, false) AS prices_include_gst,
                  inv.invoice_date::text AS invoice_date, inv.invoice_number
             FROM invoice_items ii
             JOIN invoices inv ON inv.id = ii.invoice_id
            WHERE inv.business_id = $1 AND inv.customer_id = $2 AND inv.status = 'final'
              AND COALESCE(inv.document_type, 'tax_invoice') <> 'proforma_invoice'
              AND ii.item_id = ANY($3::uuid[])
            ORDER BY ii.item_id, ii.variant_id, inv.invoice_date DESC, inv.created_at DESC`,
          [businessId, customerId, itemIds]
        )
      ).rows) {
        const rate = Number(r.tax_rate) || 0;
        const exclusive = r.prices_include_gst && rate > 0 ? r.unit_price / (1 + rate / 100) : r.unit_price;
        lastSales.set(`${r.item_id}:${r.variant_id ?? ''}`, {
          exclusivePrice: Math.round(exclusive * 100) / 100,
          discountPercent: Number(r.discount_percent) || 0,
          date: String(r.invoice_date).slice(0, 10),
          documentNumber: r.invoice_number ?? null,
        });
      }
    }
  }

  return lines.map((line) => {
    const item = items.get(line.itemId);
    const variant = line.variantId ? variants.get(line.variantId) : null;
    const variantId = variant && variant.item_id === line.itemId ? String(variant.id) : null;
    const catalogPrice = num(variant?.selling_price) ?? num(item?.selling_price);
    const opts = { variantId, qty: line.qty ?? 1, date };
    const partyRule = pickRule(partyRules.filter((r) => r.item_id === line.itemId), opts);
    const levelRule = pickRule(levelRules.filter((r) => r.item_id === line.itemId), opts);
    const catRule = item?.category_id ? pickRule(categoryDiscounts.get(item.category_id) ?? [], opts) : null;
    const resolved = resolveFromRules({
      catalogPrice,
      partyRule,
      levelRule,
      levelName,
      categoryDiscount: catRule?.discount_percent ?? null,
    });
    return {
      ...resolved,
      itemId: line.itemId,
      variantId,
      catalogPrice,
      gstIncluded: !!item?.gst_included,
      taxRate: Number(item?.tax_rate) || 0,
      costPrice: num(variant?.purchase_price) ?? num(item?.purchase_price),
      mrp: num(item?.mrp),
      lastSale: lastSales.get(`${line.itemId}:${variantId ?? ''}`) ?? lastSales.get(`${line.itemId}:`) ?? null,
    };
  });
}

/** Last price paid to a supplier for each item (pre-GST, before discount), from saved bills. */
export async function lastPurchaseRates(
  db: Queryable,
  businessId: string,
  supplierId: string,
  itemIds: string[]
): Promise<Map<string, LastRate>> {
  const out = new Map<string, LastRate>();
  if (!supplierId || itemIds.length === 0) return out;
  const rows = (
    await db.query(
      `SELECT DISTINCT ON (pi.item_id)
              pi.item_id, pi.unit_price::float AS unit_price, pi.tax_rate::float AS tax_rate, pi.tax_mode,
              COALESCE(pi.discount_percent, 0)::float AS discount_percent,
              p.bill_date::text AS bill_date, COALESCE(p.bill_number, p.invoice_number) AS bill_number
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
        WHERE p.business_id = $1 AND p.supplier_id = $2 AND p.deleted_at IS NULL AND p.cancelled_at IS NULL
          AND COALESCE(p.status, '') NOT IN ('draft', 'cancelled')
          AND pi.item_id = ANY($3::uuid[])
        ORDER BY pi.item_id, p.bill_date DESC, p.created_at DESC`,
      [businessId, supplierId, itemIds]
    )
  ).rows;
  for (const r of rows) {
    const rate = Number(r.tax_rate) || 0;
    const exclusive = r.tax_mode === 'inclusive' && rate > 0 ? r.unit_price / (1 + rate / 100) : r.unit_price;
    out.set(r.item_id, {
      exclusivePrice: Math.round(exclusive * 100) / 100,
      discountPercent: Number(r.discount_percent) || 0,
      date: String(r.bill_date).slice(0, 10),
      documentNumber: r.bill_number ?? null,
    });
  }
  return out;
}
