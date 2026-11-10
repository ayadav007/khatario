/**
 * Batch / serial tracking and per-item valuation method, as sent by the item form.
 *
 * Rules the stock code depends on:
 * - Only goods that are not bundles can be tracked (services and bundles hold no own stock).
 * - Batch tracking cannot be switched off while the item's batches still hold stock, and serial
 *   tracking cannot be switched off while serial numbers are still available: sales would stop
 *   drawing from them.
 * - Serial tracking cannot be switched on over stock that has no serial numbers: a sale of a
 *   serial-tracked item must pick an available serial for every unit, so that stock could never
 *   be sold. The same goes for opening stock on a new serial-tracked item.
 * - New values are fifo, weighted_avg or simple. lifo (not allowed under AS 2) is kept only on
 *   items that already have it.
 */

export type ValuationMethod = 'fifo' | 'weighted_avg' | 'simple' | 'lifo';

export interface ItemTracking {
  track_batch: boolean;
  track_serial: boolean;
  valuation_method: ValuationMethod;
}

export interface ItemTrackingError {
  status: number;
  code: string;
  error: string;
}

export type ResolveTrackingResult =
  | { ok: true; value: ItemTracking; provided: boolean }
  | ({ ok: false } & ItemTrackingError);

const NEW_METHODS = ['fifo', 'weighted_avg', 'simple'] as const;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function parseFlag(v: unknown): boolean | undefined | 'bad' {
  if (v === undefined || v === null) return undefined;
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return 'bad';
}

function fail(status: number, code: string, error: string): ResolveTrackingResult {
  return { ok: false, status, code, error };
}

/** Current tracking of an item row (or the defaults of a new item). */
export function currentTracking(row?: Partial<Record<keyof ItemTracking, unknown>> | null): ItemTracking {
  const m = String(row?.valuation_method ?? 'simple');
  return {
    track_batch: row?.track_batch === true,
    track_serial: row?.track_serial === true,
    valuation_method: (['fifo', 'weighted_avg', 'simple', 'lifo'].includes(m) ? m : 'simple') as ValuationMethod,
  };
}

/**
 * Body values over the current ones, checked for shape and item kind. `provided` is false when
 * the body names none of the three fields, so callers can leave the columns alone.
 */
export function resolveItemTracking(
  body: Record<string, unknown>,
  current: ItemTracking,
  kind: { itemType: string; isBundle: boolean }
): ResolveTrackingResult {
  const provided = has(body, 'track_batch') || has(body, 'track_serial') || has(body, 'valuation_method');
  const batch = parseFlag(body.track_batch);
  const serial = parseFlag(body.track_serial);
  if (batch === 'bad' || serial === 'bad') {
    return fail(400, 'INVALID_TRACKING', 'track_batch and track_serial must be true or false');
  }

  let method = current.valuation_method;
  if (body.valuation_method !== undefined && body.valuation_method !== null && body.valuation_method !== '') {
    const m = String(body.valuation_method);
    const keepsLifo = m === 'lifo' && current.valuation_method === 'lifo';
    if (!(NEW_METHODS as readonly string[]).includes(m) && !keepsLifo) {
      return fail(400, 'INVALID_VALUATION_METHOD', 'Valuation method must be fifo, weighted_avg or simple');
    }
    method = m as ValuationMethod;
  }

  const value: ItemTracking = {
    track_batch: batch ?? current.track_batch,
    track_serial: serial ?? current.track_serial,
    valuation_method: method,
  };

  const trackable = kind.itemType === 'goods' && !kind.isBundle;
  if (!trackable && (batch === true || serial === true)) {
    return fail(
      400,
      'TRACKING_NOT_ALLOWED',
      kind.isBundle
        ? 'Bundles cannot track batches or serial numbers; track them on the component items'
        : 'Only goods can track batches or serial numbers'
    );
  }
  if (!trackable) {
    value.track_batch = false;
    value.track_serial = false;
  }
  return { ok: true, value, provided };
}

/** New item: serial tracking with opening stock would leave stock no sale can pick. */
export function checkNewItemTracking(value: ItemTracking, openingStock: number): ItemTrackingError | null {
  if (value.track_serial && openingStock > 0) {
    return {
      status: 400,
      code: 'STOCK_WITHOUT_SERIALS',
      error:
        'A serial-tracked item cannot start with opening stock. Save it with 0 stock and add the units through a purchase with their serial numbers.',
    };
  }
  return null;
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** Existing item: refuse a switch that would strand stock. */
export async function checkTrackingChange(
  db: Queryable,
  businessId: string,
  itemId: string,
  before: ItemTracking,
  after: ItemTracking
): Promise<ItemTrackingError | null> {
  if (before.track_batch && !after.track_batch) {
    const r = await db.query(
      `SELECT COALESCE(SUM(quantity), 0)::numeric AS qty
         FROM item_batches WHERE business_id = $1 AND item_id = $2 AND quantity > 0`,
      [businessId, itemId]
    );
    const qty = Number(r.rows[0]?.qty ?? 0);
    if (qty > 0) {
      return {
        status: 409,
        code: 'BATCHES_IN_STOCK',
        error: `Batch tracking cannot be turned off while batches still hold ${qty} in stock. Sell, adjust or write off that stock first.`,
      };
    }
  }

  const needSerials = before.track_serial !== after.track_serial;
  if (!needSerials) return null;
  const s = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM item_serials WHERE business_id = $1 AND item_id = $2 AND status = 'available') AS available,
       (SELECT COALESCE(current_stock, 0)::numeric FROM items WHERE business_id = $1 AND id = $2) AS stock`,
    [businessId, itemId]
  );
  const available = Number(s.rows[0]?.available ?? 0);
  const stock = Number(s.rows[0]?.stock ?? 0);

  if (before.track_serial && !after.track_serial && available > 0) {
    return {
      status: 409,
      code: 'SERIALS_IN_STOCK',
      error: `Serial tracking cannot be turned off while ${available} serial number(s) are still in stock.`,
    };
  }
  if (!before.track_serial && after.track_serial && stock > available) {
    return {
      status: 409,
      code: 'STOCK_WITHOUT_SERIALS',
      error: `Serial tracking cannot be turned on while ${stock - available} unit(s) in stock have no serial number. Bring stock to 0 first, then add units through a purchase with their serial numbers.`,
    };
  }
  return null;
}
