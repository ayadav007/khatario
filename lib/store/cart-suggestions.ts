/**
 * Pure helpers for the cart drawer's suggestions row (theme setting `cart_suggestions`): in-stock products from the
 * categories of the cart's products, not already in the cart, newest first.
 */
import type { StoreItem } from './map-store-product';

export type SuggestionCandidate = Pick<StoreItem, 'id' | 'current_stock' | 'has_variants' | 'variants'>;

/** How many products the items API is asked for before the cart's own and the sold-out ones are taken out. */
export const SUGGESTION_FETCH_LIMIT = 12;

/** Same rule as the items API's `stock=1`: a product with options is in stock when any option is. */
function inStock(item: SuggestionCandidate): boolean {
  if (item.has_variants) return (item.variants ?? []).some((v) => Number(v.current_stock) > 0);
  return Number(item.current_stock) > 0;
}

/** In stock, not in the cart, each once, in candidate order, at most `limit`. */
export function pickSuggestions<T extends SuggestionCandidate>(candidates: T[], cartItemIds: Set<string>, limit = 4): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (out.length >= limit) break;
    if (cartItemIds.has(c.id) || seen.has(c.id) || !inStock(c)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** The categories of the cart's products (rows from the items API), each once, in order. */
export function cartCategoryIds(rows: Array<{ id: string; category_id: string | null }>, cartItemIds: Set<string>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (!cartItemIds.has(r.id) || !r.category_id || out.includes(r.category_id)) continue;
    out.push(r.category_id);
  }
  return out;
}

/** Items API params that look up the cart's products (for their categories). */
export function cartLookupParams(itemIds: string[], branchId: string | null | undefined): URLSearchParams {
  const p = new URLSearchParams();
  p.set('ids', itemIds.join(','));
  p.set('limit', '100');
  if (branchId) p.set('branch_id', branchId);
  return p;
}

/** Items API params for the suggestions: those categories, in stock, newest first. */
export function suggestionsParams(categoryIds: string[], branchId: string | null | undefined): URLSearchParams {
  const p = new URLSearchParams();
  p.set('cat', categoryIds.join(','));
  p.set('stock', '1');
  p.set('sort', 'new');
  p.set('limit', String(SUGGESTION_FETCH_LIMIT));
  if (branchId) p.set('branch_id', branchId);
  return p;
}
