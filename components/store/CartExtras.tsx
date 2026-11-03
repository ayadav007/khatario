'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { freeDeliveryProgress, freeShipText } from '@/lib/store/quick';
import { cartCategoryIds, cartLookupParams, pickSuggestions, suggestionsParams } from '@/lib/store/cart-suggestions';
import { engineProductHref } from '@/lib/store/engine/links';
import type { StoreProduct } from './StoreProductCard';

/**
 * What a theme (engine) store asks of the cart drawer, from its theme settings. The old storefront passes none, so
 * its cart is unchanged.
 */
export interface EngineCart {
  /** The branch's single free-delivery amount, or null. */
  freeAbove: number | null;
  freeShipBar: boolean;
  suggestions: boolean;
  suggestionsHeading: string;
  /** Task 10: "Order on WhatsApp instead". */
  whatsappOrder: boolean;
  whatsappLink: string;
  isDemo: boolean;
}

/** "Add ₹N more for free delivery" and a bar; nothing without a free-delivery amount. */
export function FreeShipBar({ subtotal, freeAbove, accent, className }: { subtotal: number; freeAbove: number | null; accent: string; className?: string }) {
  const progress = freeDeliveryProgress(subtotal, freeAbove);
  if (!progress) return null;
  return (
    <div className={clsx('text-[12.5px] font-semibold', className)} role="status">
      <span>{freeShipText(progress)}</span>
      <span
        className="mt-1.5 block h-1.5 overflow-hidden rounded-full"
        style={{ backgroundColor: 'color-mix(in srgb, currentColor 12%, transparent)' }}
        aria-hidden
      >
        <span
          className="block h-full rounded-full transition-[width] duration-300"
          style={{ width: `${Math.round(progress.ratio * 100)}%`, backgroundColor: accent }}
        />
      </span>
    </div>
  );
}

function itemsUrl(subdomain: string, params: URLSearchParams): string {
  return `/api/public/store/${encodeURIComponent(subdomain)}/items?${withStoreDraft(params)}`;
}

/**
 * Up to 4 in-stock products from the categories of the cart's products, not already in the cart, newest first.
 * Loads once each time the drawer opens; a product added from the row drops out of it straight away.
 */
export function useCartSuggestions(open: boolean, enabled: boolean): StoreProduct[] {
  const { store, cart, branches, selectedBranchId } = useStore();
  const [candidates, setCandidates] = useState<StoreProduct[]>([]);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const subdomain = store?.store_subdomain;
  const isDemo = !!store?.is_demo;
  const branchId = branches.find((b) => b.id === selectedBranchId)?.id ?? (branches.length === 1 ? branches[0].id : null);

  useEffect(() => {
    if (!open || !enabled || !subdomain) return;
    const ids = Array.from(new Set(cartRef.current.map((c) => c.itemId))).slice(0, 20);
    if (!ids.length) {
      setCandidates([]);
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const own = await fetch(itemsUrl(subdomain, cartLookupParams(ids, branchId)), { signal: ctrl.signal });
        if (!own.ok) return;
        const ownData = (await own.json()) as { items?: StoreProduct[] };
        const cats = cartCategoryIds(ownData.items ?? [], new Set(ids)).slice(0, 20);
        if (!cats.length) {
          if (!ctrl.signal.aborted) setCandidates([]);
          return;
        }
        const params = suggestionsParams(cats, branchId);
        // A demo store's catalogue ignores `cat` and `stock`: ask for all of it and keep the cart's categories here.
        if (isDemo) params.set('limit', '100');
        const res = await fetch(itemsUrl(subdomain, params), { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: StoreProduct[] };
        const sameCats = (data.items ?? []).filter((i) => i.category_id != null && cats.includes(i.category_id));
        if (!ctrl.signal.aborted) setCandidates(sameCats);
      } catch {
        /* aborted or offline: the row stays hidden */
      }
    })();
    return () => ctrl.abort();
  }, [open, enabled, subdomain, branchId, isDemo]);

  const cartIds = useMemo(() => new Set(cart.map((c) => c.itemId)), [cart]);
  return useMemo(() => (enabled ? pickSuggestions(candidates, cartIds) : []), [enabled, candidates, cartIds]);
}

/** The "Pair it with" row: small cards with `+`. A product with options opens its page instead. Hidden when empty. */
export function CartSuggestionsRow({
  heading,
  items,
  accent,
  onAccent,
  onNavigate,
  className,
}: {
  heading: string;
  items: StoreProduct[];
  accent: string;
  onAccent: string;
  /** Called when a card opens a product page (the drawer closes). */
  onNavigate: () => void;
  className?: string;
}) {
  const { addToCart } = useStore();
  if (!items.length) return null;
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const add = (p: StoreProduct) =>
    addToCart({
      itemId: p.id,
      name: p.name,
      price: p.selling_price,
      quantity: 1,
      imageUrl: p.image_url ?? undefined,
      unit: p.unit,
      maxStock: p.current_stock,
      taxRate: p.tax_rate,
      mrp: p.mrp != null && p.mrp > p.selling_price ? p.mrp : undefined,
    });
  return (
    <section className={clsx('eng-cart-suggest', className)} aria-label={heading}>
      <h3 className="mb-2 text-[13px] font-semibold">{heading}</h3>
      <ul className="grid grid-cols-4 gap-2">
        {items.map((p) => {
          const href = engineProductHref(search, p.id);
          return (
            <li key={p.id} className="flex min-w-0 flex-col">
              <Link href={href} onClick={onNavigate} className="block">
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt="" className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                ) : (
                  <span
                    className="flex aspect-square w-full items-center justify-center rounded-lg text-lg"
                    style={{ backgroundColor: 'color-mix(in srgb, currentColor 8%, transparent)' }}
                    aria-hidden
                  >
                    {p.name.charAt(0)}
                  </span>
                )}
                <span className="mt-1 line-clamp-2 text-[11.5px] leading-tight">{p.name}</span>
              </Link>
              <span className="mt-auto flex items-center justify-between gap-1 pt-1">
                <b className="text-[12px] tabular-nums">₹{Math.round(p.selling_price).toLocaleString('en-IN')}</b>
                {p.has_variants ? (
                  <Link
                    href={href}
                    onClick={onNavigate}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: accent, color: onAccent }}
                    aria-label={`Choose an option for ${p.name}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => add(p)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0"
                    style={{ backgroundColor: accent, color: onAccent }}
                    aria-label={`Add ${p.name}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
