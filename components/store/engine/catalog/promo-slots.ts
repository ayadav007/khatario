// Client-safe and pure: the catalog grid's order of product cards and promo tiles (D18).

export type CatalogSlot<T> = { kind: 'item'; item: T } | { kind: 'promo'; index: number };

/**
 * Items with each promo placed after item `position` (1-based); promos at the same position keep their
 * block order. `index` is the promo's index in `promos`. A promo past the loaded items waits for the next
 * page, unless `complete` (every item is loaded): then it goes at the end, so a short list still shows it.
 */
export function interleavePromos<T>(items: T[], promos: { position: number }[], complete = false): CatalogSlot<T>[] {
  const out: CatalogSlot<T>[] = [];
  items.forEach((item, i) => {
    out.push({ kind: 'item', item });
    promos.forEach((p, index) => {
      if (p.position === i + 1) out.push({ kind: 'promo', index });
    });
  });
  if (complete && items.length > 0) {
    promos
      .map((p, index) => ({ position: p.position, index }))
      .filter((p) => p.position > items.length)
      .sort((a, b) => a.position - b.position || a.index - b.index)
      .forEach(({ index }) => out.push({ kind: 'promo', index }));
  }
  return out;
}
