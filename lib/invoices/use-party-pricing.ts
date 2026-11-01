'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { isBelowCost, priceNote, pricingPatch, type PartyPricedRow, type ResolvedLinePrice } from '@/lib/invoices/party-price';

export type PricedLine = PartyPricedRow & {
  itemId: string;
  variantId?: string;
  quantity: number;
  name: string;
  /** Unit the line is sold in; a box is priced per box. */
  unit?: string;
  /** The item's units, once loaded (see use-item-units). More than one means it can change. */
  units?: unknown[];
};

const lineKey = (r: { itemId: string; variantId?: string }) => `${r.itemId}:${r.variantId ?? ''}`;

/**
 * Keep one free-goods line (price 0, right after its paid line) per paid line that earns free
 * units under a scheme; drop free lines whose paid line is gone or no longer earns any. Only
 * lines priced by the system get scheme lines, so saved documents are left as they were.
 */
export function reconcileSchemeLines<R extends PricedLine>(rows: R[], makeFree: (paid: R, qty: number) => R): R[] {
  const paidFree = new Map<string, { row: R; qty: number }>();
  for (const r of rows) {
    if (!r.itemId || r.schemeOf || r.priceUserOverride || !r.scheme) continue;
    const qty = Math.floor(r.quantity / r.scheme.buyQty + 1e-9) * r.scheme.freeQty;
    if (qty > 0 && !paidFree.has(lineKey(r))) paidFree.set(lineKey(r), { row: r, qty });
  }
  const out: R[] = [];
  let changed = false;
  const placed = new Set<string>();
  for (const r of rows) {
    if (r.schemeOf) {
      const want = paidFree.get(r.schemeOf);
      if (!want || placed.has(r.schemeOf)) {
        changed = true;
        continue;
      }
      placed.add(r.schemeOf);
      if (Math.abs(r.quantity - want.qty) > 1e-9) {
        out.push(makeFree(want.row, want.qty));
        changed = true;
      } else out.push(r);
      continue;
    }
    out.push(r);
    const key = r.itemId ? lineKey(r) : '';
    const want = key ? paidFree.get(key) : undefined;
    if (want && want.row === r && !rows.some((x) => x.schemeOf === key)) {
      out.push(makeFree(r, want.qty));
      placed.add(key);
      changed = true;
    }
  }
  return changed ? out : rows;
}

/**
 * Prices every line of a sales document for the selected customer on the document date, through
 * /api/pricing/resolve: customer price, then price level (with quantity slabs), then the item's
 * own price, plus customer/category/level discounts and the last rate charged. Lines whose price
 * is fixed (typed, loaded, agreed) keep it. Switching to a customer with no special price (or no
 * customer) puts the item's own price back. Returns the rows with price notes and warnings for
 * display.
 */
export function usePartyPricing<R extends PricedLine>(opts: {
  rows: R[];
  setRows: Dispatch<SetStateAction<R[]>>;
  customerId: string | null | undefined;
  date: string;
  pricesIncludeGst: boolean;
  recalc: (row: R) => R;
  disabled?: boolean;
}): Array<R & { priceNote?: string; priceWarning?: string }> {
  const { rows, setRows, customerId, date, pricesIncludeGst, recalc, disabled } = opts;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const customerRef = useRef(customerId);
  customerRef.current = customerId;
  const recalcRef = useRef(recalc);
  recalcRef.current = recalc;

  /** The free-goods line for a paid line under a scheme: same item, no charge, never repriced. */
  const makeFree = (paid: R, qty: number): R =>
    recalcRef.current({
      ...paid,
      name: `${paid.name} (free)`,
      quantity: qty,
      price: 0,
      discountPercent: 0,
      discountAmount: 0,
      priceUserOverride: true,
      discountUserOverride: true,
      partyPriceApplied: false,
      pricingDiscountApplied: false,
      priceSource: undefined,
      mrpCapped: false,
      scheme: null,
      lastSale: null,
      schemeOf: lineKey(paid),
    } as R);

  // A free line whose paid line was removed or changed goes at once, without waiting for a lookup.
  useEffect(() => {
    if (!rows.some((r) => r.schemeOf)) return;
    setRows((prev) => reconcileSchemeLines(prev, makeFree));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const key = useMemo(
    () =>
      rows
        .map((r, i) =>
          r.itemId
            ? `${i}:${r.itemId}:${r.variantId ?? ''}:${r.quantity}:${r.unit ?? ''}:${r.priceUserOverride ? '1' : '0'}:${r.discountUserOverride ? '1' : '0'}`
            : ''
        )
        .filter(Boolean)
        .join('|'),
    [rows]
  );

  useEffect(() => {
    if (disabled) return;
    const pairs = rowsRef.current.map((row, idx) => ({ row, idx })).filter(({ row }) => !!row.itemId && !row.schemeOf);
    if (pairs.length === 0) return;
    // A cash bill still asks when a line can change unit: a box has its own price or base × factor.
    if (
      !customerId &&
      !pairs.some(({ row }) => row.partyPriceApplied || row.pricingDiscountApplied || row.lastSale || (row.units?.length ?? 0) > 1)
    ) {
      return;
    }

    let cancelled = false;
    const custAtStart = customerId || null;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/pricing/resolve', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: custAtStart,
            date,
            lines: pairs.map(({ row }) => ({
              item_id: row.itemId,
              variant_id: row.variantId || null,
              qty: row.quantity,
              unit: row.unit || null,
            })),
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const resolved: ResolvedLinePrice[] = data.lines || [];
        if (cancelled || custAtStart !== (customerRef.current || null)) return;

        setRows((prev) => {
          let next = prev;
          let changed = false;
          pairs.forEach(({ idx, row }, k) => {
            const r = resolved[k];
            const current = prev[idx];
            if (
              !r ||
              !current ||
              String(current.itemId) !== String(row.itemId) ||
              (current.variantId ?? '') !== (row.variantId ?? '') ||
              (current.unit ?? '') !== (row.unit ?? '')
            ) {
              return;
            }
            const patch = pricingPatch(current, r, pricesIncludeGst);
            if (!patch) return;
            const merged = { ...current, ...patch } as R;
            if (!changed) next = [...prev];
            changed = true;
            next[idx] = 'price' in patch || 'discountPercent' in patch ? recalcRef.current(merged) : merged;
          });
          return reconcileSchemeLines(changed ? next : prev, makeFree);
        });
      } catch (e) {
        console.warn('[pricing] Price lookup failed:', e);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Rows are read through rowsRef; `key` changes whenever a line's identity, qty or override does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, key, date, pricesIncludeGst, disabled]);

  return useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        priceNote: r.itemId ? priceNote(r) : undefined,
        priceWarning: r.itemId && isBelowCost(r, pricesIncludeGst) ? 'Below purchase price' : undefined,
      })),
    [rows, pricesIncludeGst]
  );
}
