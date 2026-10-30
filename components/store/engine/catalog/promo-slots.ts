// Client-safe and pure: the catalog grid's order of product cards and promo tiles (D18).

export type CatalogSlot<T> = { kind: 'item'; item: T } | { kind: 'promo'; index: number };

/**
 * Items with each promo placed after item `position` (1-based). Promos past the loaded items are
 * dropped; promos at the same position keep their block order. `index` is the promo's index in `promos`.
 */
export function interleavePromos<T>(items: T[], promos: { position: number }[]): CatalogSlot<T>[] {
  const out: CatalogSlot<T>[] = [];
  items.forEach((item, i) => {
    out.push({ kind: 'item', item });
    promos.forEach((p, index) => {
      if (p.position === i + 1) out.push({ kind: 'promo', index });
    });
  });
  return out;
}
