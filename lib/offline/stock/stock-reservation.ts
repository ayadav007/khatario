import type { TenantScope } from '@/lib/offline/types';
import { entityCacheRepository } from '@/lib/offline/repositories/entity-cache-repository';

export type StockConfidence = 'available' | 'low_confidence' | 'unknown' | 'negative';

export interface StockReservationLine {
  itemId: string;
  variantId?: string | null;
  locationId?: string | null;
  quantity: number;
  reservedAt: number;
  actionId?: string;
}

export interface StockAvailabilityResult {
  itemId: string;
  requested: number;
  snapshotQty: number | null;
  reservedByOthers: number;
  effectiveAvailable: number | null;
  confidence: StockConfidence;
  allowNegative: boolean;
  warning?: string;
}

const RESERVATION_KIND = 'stock_reservation' as const;

function reservationKey(
  itemId: string,
  variantId?: string | null,
  locationId?: string | null
): string {
  return [itemId, variantId ?? '', locationId ?? ''].join(':');
}

async function readSnapshotQty(
  scope: TenantScope,
  itemId: string
): Promise<number | null> {
  const cached = await entityCacheRepository.getByKey(scope, 'stock_summary', itemId);
  if (!cached?.data) return null;
  const data = cached.data as { quantity?: number; current_stock?: number };
  const qty = data.quantity ?? data.current_stock;
  return typeof qty === 'number' ? qty : null;
}

/** Sum pending reservations for an item from entity cache metadata. */
async function sumPendingReservations(
  scope: TenantScope,
  itemId: string,
  excludeActionId?: string
): Promise<number> {
  const all = await entityCacheRepository.listByKind(scope, 'stock_summary');
  let total = 0;
  for (const row of all) {
    const data = row.data as {
      pending_reservations?: StockReservationLine[];
    };
    for (const r of data.pending_reservations ?? []) {
      if (r.itemId !== itemId) continue;
      if (excludeActionId && r.actionId === excludeActionId) continue;
      total += r.quantity;
    }
  }
  return total;
}

export async function checkStockAvailability(input: {
  scope: TenantScope;
  itemId: string;
  quantity: number;
  variantId?: string | null;
  locationId?: string | null;
  allowNegative?: boolean;
  excludeActionId?: string;
}): Promise<StockAvailabilityResult> {
  const snapshotQty = await readSnapshotQty(input.scope, input.itemId);
  const reservedByOthers = await sumPendingReservations(
    input.scope,
    input.itemId,
    input.excludeActionId
  );

  let confidence: StockConfidence = 'unknown';
  let effectiveAvailable: number | null = null;
  let warning: string | undefined;

  if (snapshotQty != null) {
    effectiveAvailable = snapshotQty - reservedByOthers;
    confidence =
      effectiveAvailable >= input.quantity
        ? 'available'
        : effectiveAvailable >= 0
          ? 'low_confidence'
          : 'negative';
  }

  if (
    effectiveAvailable != null &&
    effectiveAvailable < input.quantity &&
    !input.allowNegative
  ) {
    warning = `Stock may be insufficient (snapshot ${effectiveAvailable}, need ${input.quantity})`;
    confidence = 'low_confidence';
  }

  if (input.allowNegative && effectiveAvailable != null && effectiveAvailable < input.quantity) {
    confidence = 'negative';
  }

  return {
    itemId: input.itemId,
    requested: input.quantity,
    snapshotQty,
    reservedByOthers,
    effectiveAvailable,
    confidence,
    allowNegative: input.allowNegative ?? false,
    warning,
  };
}

export async function applyStockReservation(input: {
  scope: TenantScope;
  lines: StockReservationLine[];
}): Promise<void> {
  for (const line of input.lines) {
    const key = reservationKey(line.itemId, line.variantId, line.locationId);
    const existing = await entityCacheRepository.getByKey(
      input.scope,
      'stock_summary',
      line.itemId
    );
    const base = (existing?.data as Record<string, unknown>) ?? { item_id: line.itemId };
    const pending = (base.pending_reservations as StockReservationLine[]) ?? [];
    pending.push(line);
    const snapshotQty =
      typeof base.quantity === 'number'
        ? base.quantity
        : typeof base.current_stock === 'number'
          ? base.current_stock
          : null;
    const optimisticQty =
      snapshotQty != null ? snapshotQty - line.quantity : snapshotQty;
    await entityCacheRepository.upsert(input.scope, 'stock_summary', line.itemId, {
      ...base,
      item_id: line.itemId,
      quantity: optimisticQty,
      current_stock: optimisticQty,
      pending_reservations: pending,
      reservation_key: key,
      updated_at: Date.now(),
    });
  }
}

export async function releaseStockReservation(input: {
  scope: TenantScope;
  actionId: string;
}): Promise<void> {
  const all = await entityCacheRepository.listByKind(input.scope, 'stock_summary');
  for (const row of all) {
    const data = row.data as {
      pending_reservations?: StockReservationLine[];
      quantity?: number;
      current_stock?: number;
    };
    const pending = data.pending_reservations ?? [];
    const kept = pending.filter((r) => r.actionId !== input.actionId);
    if (kept.length === pending.length) continue;
    const released = pending
      .filter((r) => r.actionId === input.actionId)
      .reduce((s, r) => s + r.quantity, 0);
    const baseQty = data.quantity ?? data.current_stock ?? null;
    const restored = baseQty != null ? baseQty + released : baseQty;
    await entityCacheRepository.upsert(input.scope, 'stock_summary', row.entityKey, {
      ...data,
      quantity: restored,
      current_stock: restored,
      pending_reservations: kept,
    });
  }
}

export async function updateStockSnapshot(
  scope: TenantScope,
  itemId: string,
  quantity: number
): Promise<void> {
  await entityCacheRepository.upsert(scope, 'stock_summary', itemId, {
    item_id: itemId,
    quantity,
    current_stock: quantity,
    snapshot_at: Date.now(),
    pending_reservations: [],
  });
}
