'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Heart, Loader2, Minus, Plus, Truck } from 'lucide-react';
import { StoreProductGallery } from './StoreProductGallery';
import { StoreStars } from './StoreStars';
import clsx from 'clsx';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { chowkOnAccent, sanitizeStoreTheme, sectionEnabled } from '@/lib/store/store-theme';
import { storeDiscountPercent } from '@/lib/store/map-store-product';
import { StoreProductCard, type StoreProduct } from './StoreProductCard';

function aboutLines(description: string | null): string[] {
  const raw = (description || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/\n+|•/)
    .map((s) => s.replace(/^[-–*]\s*/, '').trim())
    .filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 8);
  return raw.length > 220 ? [raw] : parts;
}

export function StoreKhatarioProductView({
  product,
  onRelatedOpen,
  compact = false,
}: {
  product: StoreProduct;
  onRelatedOpen?: (item: StoreProduct) => void;
  compact?: boolean;
}) {
  const { store, cart, addToCart, updateCartQuantity, selectedBranchId, branches, customer, favoriteIds, toggleFavorite, rateProduct } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const onAccent = chowkOnAccent(accent);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    product.variants[0]?.id ?? null,
  );
  const [related, setRelated] = useState<StoreProduct[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [ratingAvg, setRatingAvg] = useState(product.rating_avg ?? 0);
  const [ratingCount, setRatingCount] = useState(product.rating_count ?? 0);

  useEffect(() => {
    setRatingAvg(product.rating_avg ?? 0);
    setRatingCount(product.rating_count ?? 0);
  }, [product.id, product.rating_avg, product.rating_count]);

  useEffect(() => {
    setSelectedVariantId(product.variants[0]?.id ?? null);
  }, [product.id, product.variants]);

  useEffect(() => {
    if (!store) return;
    const params = new URLSearchParams();
    params.set('limit', '8');
    if (product.category_id) params.set('category_id', product.category_id);
    if (selectedBranchId) params.set('branch_id', selectedBranchId);
    setRelatedLoading(true);
    void fetch(
      `/api/public/store/${encodeURIComponent(store.store_subdomain)}/items?${withStoreDraft(params)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const items = (data?.items as StoreProduct[] | undefined) ?? [];
        setRelated(items.filter((i) => i.id !== product.id).slice(0, 8));
      })
      .finally(() => setRelatedLoading(false));
  }, [store, product.id, product.category_id, selectedBranchId]);

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId);
  const displayPrice = selectedVariant?.selling_price ?? product.selling_price;
  const displayStock = selectedVariant?.current_stock ?? product.current_stock;
  const outOfStock = displayStock <= 0;
  const discount = sectionEnabled(theme, 'offers')
    ? storeDiscountPercent(product.mrp, displayPrice)
    : 0;
  const bullets = useMemo(() => aboutLines(product.description), [product.description]);
  const branch = branches.find((b) => b.id === selectedBranchId);
  const cartItem = cart.find(
    (c) =>
      c.itemId === product.id &&
      (product.has_variants ? c.variantId === selectedVariantId : !c.variantId),
  );

  const pushCart = useCallback(() => {
    addToCart({
      itemId: product.id,
      variantId: selectedVariantId ?? undefined,
      name: product.name,
      variantName: selectedVariant?.variant_name,
      price: displayPrice,
      quantity: 1,
      imageUrl: product.image_url ?? undefined,
      unit: product.unit,
      maxStock: displayStock,
      taxRate: product.tax_rate,
    });
  }, [product, selectedVariantId, selectedVariant, displayPrice, displayStock, addToCart]);

  const buyNow = () => {
    if (!cartItem) pushCart();
    window.location.href = '/checkout';
  };

  return (
    <div className="pb-28">
      <div className={clsx('relative bg-white', compact ? 'pt-8' : '')}>
        <button
          type="button"
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-sm"
          style={compact ? { top: '2.75rem' } : undefined}
          aria-label={favoriteIds.includes(product.id) ? 'Remove from favourites' : 'Save to favourites'}
          onClick={() => void toggleFavorite(product.id)}
        >
          <Heart
            className="h-5 w-5"
            style={{
              color: favoriteIds.includes(product.id) ? accent : '#6b7280',
              fill: favoriteIds.includes(product.id) ? accent : 'transparent',
            }}
          />
        </button>
        <StoreProductGallery
          images={product.images?.length ? product.images : product.image_url ? [product.image_url] : []}
          alt={product.name}
          accent={accent}
        />
      </div>

      <div className="px-4 pt-4">
        <h1 className="text-[1.15rem] font-medium leading-snug text-gray-900 sm:text-xl">{product.name}</h1>
        {product.category_name || product.unit ? (
          <p className="mt-1 text-[12px] text-gray-500">
            {[product.category_name, product.unit].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        <div className="mt-2">
          <StoreStars
            value={ratingAvg}
            count={ratingCount}
            size="md"
            onRate={
              customer
                ? async (n) => {
                    const next = await rateProduct(product.id, n);
                    if (next) {
                      setRatingAvg(next.rating_avg);
                      setRatingCount(next.rating_count);
                    }
                  }
                : undefined
            }
          />
          {!customer ? (
            <p className="mt-1 text-[11px] text-gray-400">Sign in at checkout to rate this item.</p>
          ) : (
            <p className="mt-1 text-[11px] text-gray-400">Tap a star to rate</p>
          )}
        </div>

        <div className="mt-3 border-t border-gray-100 pt-3">
          {discount > 0 ? (
            <p className="text-[13px] font-semibold" style={{ color: accent }}>
              −{discount}%
              <span className="ml-2 text-[11px] font-normal text-gray-500">Limited offer</span>
            </p>
          ) : null}
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[1.65rem] font-semibold tabular-nums tracking-tight text-gray-900">
              ₹{displayPrice.toLocaleString('en-IN')}
            </span>
            {discount > 0 && product.mrp != null ? (
              <span className="text-[13px] text-gray-500">
                M.R.P:{' '}
                <span className="line-through">₹{Number(product.mrp).toLocaleString('en-IN')}</span>
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">Inclusive of all taxes</p>
          {product.tax_rate > 0 ? (
            <p className="text-[11px] text-gray-400">
              GST {product.tax_rate}%{product.gst_included ? ' included' : ' extra'}
            </p>
          ) : null}
        </div>

        <div className="mt-3 flex items-start gap-2 text-[13px]">
          <Truck className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <p className="text-gray-700">
            Delivery from <span className="font-medium">{branch?.name || store?.name}</span>
            {store?.store_min_order_amount ? (
              <span className="block text-[12px] text-gray-500">
                Minimum order ₹{store.store_min_order_amount.toLocaleString('en-IN')}
              </span>
            ) : null}
          </p>
        </div>

        <p className={clsx('mt-2 text-[13px] font-medium', outOfStock ? 'text-red-700' : 'text-emerald-700')}>
          {outOfStock ? 'Currently unavailable' : 'In stock'}
        </p>
        <p className="text-[12px] text-gray-500">Sold by {store?.name}</p>

        {product.has_variants && product.variants.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-[12px] font-medium text-gray-700">Options</p>
            <div className="flex flex-wrap gap-2">
              {product.variants.map((v) => {
                const on = v.id === selectedVariantId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    disabled={v.current_stock <= 0}
                    onClick={() => setSelectedVariantId(v.id)}
                    className="min-h-10 rounded-lg border px-3 text-[13px] disabled:opacity-40"
                    style={{
                      borderColor: on ? accent : '#e5e7eb',
                      backgroundColor: on ? `color-mix(in srgb, ${accent} 10%, white)` : '#fff',
                    }}
                  >
                    {v.variant_name}
                    <span className="ml-1.5 tabular-nums text-gray-500">₹{v.selling_price.toLocaleString('en-IN')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {bullets.length > 0 ? (
          <section className="mt-5">
            <h2 className="text-[15px] font-semibold text-gray-900">About this item</h2>
            {bullets.length === 1 ? (
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-600">{bullets[0]}</p>
            ) : (
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-gray-700">
                {bullets.map((line) => (
                  <li key={line.slice(0, 40)}>{line}</li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="text-[15px] font-semibold text-gray-900">
            {product.category_name ? `Related in ${product.category_name}` : 'Related products'}
          </h2>
          {relatedLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : related.length === 0 ? (
            <p className="mt-2 text-[13px] text-gray-500">No other items in this category yet.</p>
          ) : (
            <div className="store-chowk-rail -mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pb-1">
              {related.map((item) => (
                <StoreProductCard key={item.id} product={item} variant="shelf" onViewDetail={onRelatedOpen} />
              ))}
            </div>
          )}
        </section>
      </div>

      {theme.sticky_buy_now ? (
      <div
        className={clsx(
          'border-t border-gray-100 bg-white/95 px-4 pt-2 backdrop-blur',
          compact
            ? 'sticky bottom-0 z-10 pb-[max(0.65rem,env(safe-area-inset-bottom))]'
            : 'fixed inset-x-0 z-40 pb-[max(0.65rem,env(safe-area-inset-bottom))]',
        )}
        style={compact ? undefined : { bottom: 'calc(var(--chowk-nav, 0px) + var(--chowk-safe, 0px))' }}
      >
        {outOfStock ? (
          <p className="py-3 text-center text-sm text-gray-500">This item is out of stock</p>
        ) : (
          <div className="mx-auto flex max-w-lg flex-col gap-2">
            {cartItem ? (
              <div className="flex items-center justify-between rounded-xl border border-gray-200 px-2">
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center"
                  aria-label="Decrease quantity"
                  onClick={() =>
                    updateCartQuantity(product.id, selectedVariantId ?? undefined, cartItem.quantity - 1)
                  }
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold tabular-nums">{cartItem.quantity} in bag</span>
                <button
                  type="button"
                  className="flex h-11 w-11 items-center justify-center"
                  aria-label="Increase quantity"
                  disabled={cartItem.quantity >= displayStock}
                  onClick={() =>
                    updateCartQuantity(product.id, selectedVariantId ?? undefined, cartItem.quantity + 1)
                  }
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={pushCart}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold"
                style={{ backgroundColor: `color-mix(in srgb, ${accent} 18%, white)`, color: accent, border: `1px solid ${accent}` }}
              >
                Add to cart · ₹{displayPrice.toLocaleString('en-IN')}
              </button>
            )}
            <button
              type="button"
              onClick={buyNow}
              className="flex min-h-12 w-full items-center justify-center gap-1.5 rounded-full text-[14px] font-semibold"
              style={{ backgroundColor: accent, color: onAccent }}
            >
              {cartItem ? <Check className="h-4 w-4" /> : null}
              Buy now
            </button>
          </div>
        )}
      </div>
      ) : null}
    </div>
  );
}
