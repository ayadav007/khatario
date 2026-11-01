'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/**
 * Selling a line in one of the item's alternate units (BOX = 12 PCS) on the bill screens.
 * The server works out the factor again from the item's units when the bill is saved; the screen
 * only needs the list to offer and an estimate of the price until /api/pricing/resolve answers.
 */

export interface SaleUnitOption {
  unit: string;
  /** Base units in one of this unit (1 for the item's own unit). */
  factor: number;
}

export interface UnitRow {
  itemId?: string;
  /** Screens whose rows use the API's field name (challans). */
  item_id?: string | null;
  unit: string;
  price?: number;
  mrp?: number;
  costPrice?: number | null;
  priceUserOverride?: boolean;
  /** The item's own unit first, then its alternates. Undefined until loaded. */
  units?: SaleUnitOption[];
}

/** Base units in one of the row's unit (1 when the unit is the item's own or unknown). */
export function unitFactorOf(row: Pick<UnitRow, 'unit' | 'units'>): number {
  const u = row.units?.find((x) => x.unit.toUpperCase() === String(row.unit || '').toUpperCase());
  return u?.factor || 1;
}

/** "= 60 PCS" under a line sold in boxes; undefined for a line in the item's own unit. */
export function baseQtyLabel(row: Pick<UnitRow, 'unit' | 'units'> & { quantity: number }): string | undefined {
  const f = unitFactorOf(row);
  if (f === 1 || !row.units?.length) return undefined;
  const q = Math.round(row.quantity * f * 1000) / 1000;
  return `= ${q.toLocaleString('en-IN')} ${row.units[0].unit}`;
}

/**
 * The row switched to `unit`. Price, MRP and cost scale by the change in factor at once; the price
 * resolver then replaces the price with the unit's own price or the customer's rate. A hand-typed
 * price is per the old unit, so it is let go.
 */
export function withSaleUnit<R extends UnitRow>(row: R, unit: string): R {
  const from = unitFactorOf(row);
  const next = row.units?.find((x) => x.unit.toUpperCase() === unit.toUpperCase());
  if (!next) return row;
  const k = next.factor / from;
  const scale = (v: number | null | undefined) => (v == null ? v : Math.round(v * k * 100) / 100);
  return {
    ...row,
    unit: next.unit,
    price: scale(row.price) as number,
    mrp: scale(row.mrp) as number | undefined,
    costPrice: scale(row.costPrice) as number | null | undefined,
    priceUserOverride: false,
  };
}

const cache = new Map<string, SaleUnitOption[]>();
const rowItemId = (r: UnitRow) => String(r.itemId || r.item_id || '');

/**
 * Loads the units each item on the bill can be sold in and keeps them on the rows (`units`).
 * Items without alternates get a one-entry list, so the screen shows the unit as plain text.
 */
export function useItemUnits<R extends UnitRow>(rows: R[], setRows: Dispatch<SetStateAction<R[]>>, disabled?: boolean): void {
  const pending = useRef(new Set<string>());
  const missingKey = useMemo(
    () =>
      [...new Set(rows.filter((r) => rowItemId(r) && !r.units).map(rowItemId))]
        .sort()
        .join(','),
    [rows]
  );

  useEffect(() => {
    if (disabled || !missingKey) return;
    const ids = missingKey.split(',');
    const apply = () =>
      setRows((prev) => {
        let changed = false;
        const next = prev.map((r) => {
          if (!rowItemId(r) || r.units) return r;
          const units = cache.get(rowItemId(r));
          if (!units) return r;
          changed = true;
          return { ...r, units };
        });
        return changed ? next : prev;
      });
    const toFetch = ids.filter((id) => !cache.has(id) && !pending.current.has(id));
    if (toFetch.length === 0) {
      apply();
      return;
    }
    toFetch.forEach((id) => pending.current.add(id));
    // Applied even if the rows changed meanwhile: `apply` only fills rows still missing units.
    (async () => {
      try {
        const res = await fetch(`/api/items/units?ids=${toFetch.join(',')}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        for (const id of toFetch) {
          const item = data.items?.[id];
          const own: SaleUnitOption = { unit: String(item?.unit || 'PCS'), factor: 1 };
          const alts: SaleUnitOption[] = (item?.units || []).map((u: { unit: string; factor_to_base: number }) => ({
            unit: u.unit,
            factor: Number(u.factor_to_base) || 1,
          }));
          cache.set(id, [own, ...alts]);
        }
        apply();
      } catch (e) {
        console.warn('[units] Could not load item units:', e);
      } finally {
        toFetch.forEach((id) => pending.current.delete(id));
      }
    })();
  }, [missingKey, disabled, setRows]);
}
