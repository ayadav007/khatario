'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { isBelowCost, priceNote, pricingPatch, type PartyPricedRow, type ResolvedLinePrice } from '@/lib/invoices/party-price';

export type PricedLine = PartyPricedRow & { itemId: string; variantId?: string; quantity: number };

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

  const key = useMemo(
    () =>
      rows
        .map((r, i) =>
          r.itemId
            ? `${i}:${r.itemId}:${r.variantId ?? ''}:${r.quantity}:${r.priceUserOverride ? '1' : '0'}:${r.discountUserOverride ? '1' : '0'}`
            : ''
        )
        .filter(Boolean)
        .join('|'),
    [rows]
  );

  useEffect(() => {
    if (disabled) return;
    const pairs = rowsRef.current.map((row, idx) => ({ row, idx })).filter(({ row }) => !!row.itemId);
    if (pairs.length === 0) return;
    if (!customerId && !pairs.some(({ row }) => row.partyPriceApplied || row.pricingDiscountApplied || row.lastSale)) return;

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
            lines: pairs.map(({ row }) => ({ item_id: row.itemId, variant_id: row.variantId || null, qty: row.quantity })),
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
            if (!r || !current || String(current.itemId) !== String(row.itemId) || (current.variantId ?? '') !== (row.variantId ?? '')) return;
            const patch = pricingPatch(current, r, pricesIncludeGst);
            if (!patch) return;
            const merged = { ...current, ...patch } as R;
            if (!changed) next = [...prev];
            changed = true;
            next[idx] = 'price' in patch || 'discountPercent' in patch ? recalcRef.current(merged) : merged;
          });
          return changed ? next : prev;
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
