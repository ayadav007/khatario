import type { PoolClient } from 'pg';
import { hashReplayPayload } from '@/lib/offline-sync/types';
import type { OfflineReplayLogRow } from '@/lib/offline-sync/types';
import { findReplayLog } from '@/lib/offline-sync/replay-log-repository';

/**
 * Retry protection for POST /api/items.
 *
 * Same storage as payments: `offline_replay_log`, unique per business, under an `items.create:`
 * namespace. The row is inserted inside the item transaction (together with its opening stock)
 * and marked completed just before COMMIT, so a rolled-back create leaves no row and a completed
 * row always names an item that exists. Requests without a key are not deduplicated.
 */
export const ITEM_CREATE_IDEMPOTENCY_ACTION = 'items.create';

export const ITEM_IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';
export const ITEM_IDEMPOTENCY_IN_PROGRESS = 'IDEMPOTENCY_IN_PROGRESS';
export const ITEM_IDEMPOTENCY_REPLAY_UNAVAILABLE = 'IDEMPOTENCY_REPLAY_UNAVAILABLE';

export function scopedItemCreateKey(key: string): string {
  return `${ITEM_CREATE_IDEMPOTENCY_ACTION}:${key}`;
}

const text = (v: unknown) => (v === undefined || v === null ? null : String(v).trim() || null);
const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

/** Fields that decide what gets created and posted. A retry must send the same values. */
export function itemCreateFingerprint(body: Record<string, unknown>): {
  hash: string;
  storedPayload: Record<string, unknown>;
} {
  const storedPayload = {
    name: text(body.name),
    barcode: text(body.barcode)?.replace(/\s+/g, '') ?? null,
    unit: text(body.unit) ?? 'PCS',
    item_type: text(body.item_type) ?? 'goods',
    opening_stock: num(body.opening_stock) ?? 0,
    purchase_price: num(body.purchase_price) ?? 0,
    selling_price: num(body.selling_price),
    mrp: num(body.mrp),
    tax_rate: num(body.tax_rate) ?? 0,
    has_variants: body.has_variants === true,
    opening_batch: body.opening_batch && typeof body.opening_batch === 'object' ? body.opening_batch : null,
  };
  return { hash: hashReplayPayload(storedPayload), storedPayload };
}

/**
 * `unavailable` covers every ownership or consistency failure and carries no item data, so a bad
 * record can never leak another business's item.
 */
export type ItemCreateIdempotencyOutcome =
  | { kind: 'replay'; item: Record<string, unknown> }
  | { kind: 'conflict' }
  | { kind: 'in_progress' }
  | { kind: 'unavailable' };

type Queryable = Pick<PoolClient, 'query'>;
type ReplayContext = { businessId: string; scopedKey: string; hash: string };

export async function resolveItemCreateRecord(
  q: Queryable,
  row: OfflineReplayLogRow,
  ctx: ReplayContext
): Promise<ItemCreateIdempotencyOutcome> {
  if (
    row.business_id !== ctx.businessId ||
    row.idempotency_key !== ctx.scopedKey ||
    row.action_type !== ITEM_CREATE_IDEMPOTENCY_ACTION
  ) {
    return { kind: 'unavailable' };
  }
  if (row.request_hash !== ctx.hash) return { kind: 'conflict' };
  if (row.status === 'pending' || row.status === 'processing') return { kind: 'in_progress' };
  if (row.status !== 'completed' || row.entity_type !== 'item' || !row.entity_id) return { kind: 'unavailable' };

  const res = await q.query(
    `SELECT * FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [row.entity_id, ctx.businessId]
  );
  const item = res.rows[0] as Record<string, unknown> | undefined;
  return item ? { kind: 'replay', item } : { kind: 'unavailable' };
}

/** Read-only check before validation. Null when this business has no record for the key. */
export async function findItemCreateOutcome(
  q: Queryable,
  ctx: ReplayContext
): Promise<ItemCreateIdempotencyOutcome | null> {
  const row = await findReplayLog(ctx.businessId, ctx.scopedKey);
  return row ? resolveItemCreateRecord(q, row, ctx) : null;
}

export function itemIdempotencyErrorBody(kind: 'conflict' | 'in_progress' | 'unavailable'): {
  error: string;
  code: string;
} {
  if (kind === 'conflict') {
    return {
      error: 'This idempotency key was already used for a different item.',
      code: ITEM_IDEMPOTENCY_KEY_REUSED,
    };
  }
  if (kind === 'in_progress') {
    return {
      error: 'This item is still being saved. Try again in a moment.',
      code: ITEM_IDEMPOTENCY_IN_PROGRESS,
    };
  }
  return {
    error: 'This idempotency key cannot be replayed. Use a new key to add a new item.',
    code: ITEM_IDEMPOTENCY_REPLAY_UNAVAILABLE,
  };
}
