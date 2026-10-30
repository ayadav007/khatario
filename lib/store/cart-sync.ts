import type { CartLine } from './abandoned-carts';
import type { StoreCartItem } from './store-context';

/**
 * Storefront ↔ server cart sync (spec 2026-10-29-store-shopping-features §7.3), kept pure so the
 * provider only wires it up. The server is the source of price, name and image; the client sends
 * item, variant and quantity.
 */

export const CART_SYNC_DEBOUNCE_MS = 2000;

export type CartSyncLine = { item_id: string; variant_id: string | null; quantity: number };

/** `GET …/cart` line: the saved snapshot plus what the storefront needs to show it. */
export type ServerCartLine = CartLine & {
  item_name?: string;
  variant_name?: string | null;
  unit?: string;
  stock?: number;
};

const keyOf = (itemId: string, variantId: string | null | undefined) => `${itemId}:${variantId ?? ''}`;

export function toSyncLines(cart: StoreCartItem[]): CartSyncLine[] {
  return cart.map((c) => ({ item_id: c.itemId, variant_id: c.variantId ?? null, quantity: c.quantity }));
}

/** Identity of what a PUT would send; equal signatures need no new PUT. */
export function cartSignature(cart: StoreCartItem[]): string {
  return JSON.stringify(toSyncLines(cart));
}

function fromServer(l: ServerCartLine): StoreCartItem {
  const qty = Number(l.quantity) || 1;
  const stock = Number(l.stock);
  return {
    itemId: l.item_id,
    variantId: l.variant_id ?? undefined,
    name: l.item_name || l.name,
    variantName: l.item_name ? l.variant_name ?? undefined : undefined,
    price: Number(l.price) || 0,
    quantity: qty,
    imageUrl: l.image_url ?? undefined,
    unit: l.unit || 'PCS',
    // Never below what is already in the cart; checkout re-checks stock anyway.
    maxStock: Math.max(Number.isFinite(stock) ? stock : 0, qty),
  };
}

/**
 * Same rule as `mergeCarts`: union by item and variant, the server quantity wins, server lines
 * first then lines only this device has. A line on both sides keeps the local details.
 */
export function mergeServerCart(local: StoreCartItem[], server: ServerCartLine[]): StoreCartItem[] {
  const localByKey = new Map(local.map((c) => [keyOf(c.itemId, c.variantId), c]));
  const seen = new Set<string>();
  const out: StoreCartItem[] = [];
  for (const s of server) {
    const k = keyOf(s.item_id, s.variant_id);
    if (seen.has(k)) continue;
    seen.add(k);
    const mine = localByKey.get(k);
    out.push(mine ? { ...mine, quantity: Number(s.quantity) || mine.quantity } : fromServer(s));
  }
  for (const c of local) {
    const k = keyOf(c.itemId, c.variantId);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Sync only for a signed-in shopper on a real store, never in a Studio draft preview or demo. */
export function cartSyncEnabled(opts: {
  customerId: string | null | undefined;
  storeLoaded: boolean;
  isDemo: boolean | undefined;
  draft: boolean;
}): boolean {
  return !!opts.customerId && opts.storeLoaded && !opts.isDemo && !opts.draft;
}

/** Debounced PUT: only after the sign-in merge for this shopper, and only when the cart changed. */
export function shouldPutCart(opts: {
  enabled: boolean;
  customerId: string | null | undefined;
  mergedFor: string | null;
  merging: boolean;
  signature: string;
  lastSent: string | null;
}): boolean {
  return (
    opts.enabled &&
    !!opts.customerId &&
    opts.mergedFor === opts.customerId &&
    !opts.merging &&
    opts.signature !== opts.lastSent
  );
}
