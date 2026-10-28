import type { PoolClient } from 'pg';

/** Shared parsing and history logging for customer prices, level rates and category discounts. */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class RateInputError extends Error {}

/** '' or missing means none; a UUID is kept; anything else throws. */
export function optionalUuid(raw: unknown, label: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !UUID_RE.test(raw.trim())) throw new RateInputError(`Invalid ${label}`);
  return raw.trim();
}

function optionalNumber(raw: unknown, label: string, max?: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || (max != null && n > max)) throw new RateInputError(`Invalid ${label}`);
  return Math.round(n * 100) / 100;
}

function optionalDate(raw: unknown, label: string): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) throw new RateInputError(`Invalid ${label}`);
  return raw;
}

export interface RateFields {
  price: number | null;
  discount_percent: number | null;
  valid_from: string | null;
  valid_to: string | null;
}

/** A rate with neither price nor discount means "remove it". */
export function parseRateFields(raw: Record<string, unknown>): RateFields {
  const fields = {
    price: optionalNumber(raw.price, 'price'),
    discount_percent: optionalNumber(raw.discount_percent, 'discount %', 100),
    valid_from: optionalDate(raw.valid_from, 'start date'),
    valid_to: optionalDate(raw.valid_to, 'end date'),
  };
  if (fields.valid_from && fields.valid_to && fields.valid_from > fields.valid_to) {
    throw new RateInputError('The end date is before the start date');
  }
  return fields;
}

export const isRemoval = (f: RateFields) => f.price == null && f.discount_percent == null;

export interface PriceChange {
  businessId: string;
  scope: 'party_item' | 'price_level' | 'party_category';
  partyId?: string | null;
  priceLevelId?: string | null;
  itemId?: string | null;
  variantId?: string | null;
  categoryId?: string | null;
  minQty?: number | null;
  old: { price: number | null; discount_percent: number | null } | null;
  next: RateFields | null;
  changedBy: string;
}

const same = (a: number | null | undefined, b: number | null | undefined) =>
  (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9);

/** Records a change unless nothing moved. */
export async function logPriceChange(client: Pick<PoolClient, 'query'>, c: PriceChange): Promise<void> {
  const oldPrice = c.old?.price ?? null;
  const oldDisc = c.old?.discount_percent ?? null;
  const newPrice = c.next?.price ?? null;
  const newDisc = c.next?.discount_percent ?? null;
  if (c.old && c.next && same(oldPrice, newPrice) && same(oldDisc, newDisc)) return;
  if (!c.old && !c.next) return;
  await client.query(
    `INSERT INTO price_change_log
       (business_id, scope, party_id, price_level_id, item_id, variant_id, category_id, min_qty,
        old_price, new_price, old_discount_percent, new_discount_percent, valid_from, valid_to, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      c.businessId,
      c.scope,
      c.partyId ?? null,
      c.priceLevelId ?? null,
      c.itemId ?? null,
      c.variantId ?? null,
      c.categoryId ?? null,
      c.minQty ?? null,
      oldPrice,
      newPrice,
      oldDisc,
      newDisc,
      c.next?.valid_from ?? null,
      c.next?.valid_to ?? null,
      c.changedBy,
    ]
  );
}

/** Runs `fn` in a transaction on its own client. */
export async function inTransaction<T>(pool: { connect(): Promise<PoolClient> }, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
