'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Check, Heart, Loader2, Minus, Plus, Truck } from 'lucide-react';
import { ProductGallery } from './features/product/ProductGallery';
import { ProductInfoTabs } from './features/product/ProductInfoTabs';
import { VariantPicker } from './features/product/VariantPicker';
import { findVariant, productOffer, toVariantInputs, type StoreProductDetail } from './features/product/product-view';
import { StoreStars } from './StoreStars';
import clsx from 'clsx';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { chowkOnAccent, sanitizeStoreTheme, sectionEnabled } from '@/lib/store/store-theme';
import { storeDiscountPercent } from '@/lib/store/map-store-product';
import { StoreProductCard, type StoreProduct } from './StoreProductCard';
import { ProductReviewsSection } from './features/reviews/ProductReviewsSection';
import { ReviewSummaryCompact } from './features/reviews/ReviewSummary';

/** Square gallery stays inside the screen: ~60% of it on the page, smaller in the modal. */
const GALLERY_FIT = '[&_[aria-roledescription=carousel]]:max-h-[60vh]';
const GALLERY_FIT_COMPACT =
  '[&_[aria-roledescription=carousel]]:max-h-[50vh] sm:[&_[aria-roledescription=carousel]]:max-h-[420px]';

export function StoreKhatarioProductView({
  product,
  onRelatedOpen,
  compact = false,
}: {
  product: StoreProductDetail;
  onRelatedOpen?: (item: StoreProduct) => void;
  compact?: boolean;
}) {
  const { store, cart, addToCart, updateCartQuantity, selectedBranchId, branches, customer, favoriteIds, toggleFavorite, rateProduct } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const onAccent = chowkOnAccent(accent);
  const variants = useMemo(() => toVariantInputs(product.variants), [product.variants]);
  // Choices belong to the product they were made on; VariantPicker preselects on a new product.
  const [picked, setPicked] = useState<{ productId: string; variantId: string | null } | null>(null);
  const selectedVariantId = picked && picked.productId === product.id ? picked.variantId : null;
  const setSelectedVariantId = useCallback(
    (id: string | null) => setPicked({ productId: product.id, variantId: id }),
    [product.id],
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

  const selectedVariant = findVariant(variants, selectedVariantId);
  const offer = productOffer(product, selectedVariant, variants.length);
  const displayPrice = offer.price;
  const displayStock = offer.stock;
  const outOfStock = !offer.canAdd;
  const discount = sectionEnabled(theme, 'offers')
    ? storeDiscountPercent(product.mrp, displayPrice)
    : 0;
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
    <div
      className="pb-28"
      style={{ '--primary': accent, '--on-primary': onAccent, '--paper': '#ffffff' } as CSSProperties}
    >
      <div className={clsx('relative bg-white', compact ? 'pt-8' : '', compact ? GALLERY_FIT_COMPACT : GALLERY_FIT)}>
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
        <ProductGallery
          images={product.images?.length ? product.images : product.image_url ? [product.image_url] : []}
          videoUrl={product.video_url}
          alt={product.name}
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
          {compact ? (
            <ReviewSummaryCompact itemId={product.id} avg={ratingAvg} count={ratingCount} stars={false} />
          ) : null}
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

        {product.has_variants && variants.length > 0 ? (
          <div className="mt-4">
            <VariantPicker variants={variants} value={selectedVariantId} onChange={setSelectedVariantId} />
          </div>
        ) : null}

        <div className="mt-5">
          <ProductInfoTabs
            description={product.description}
            tabs={product.store_tabs ?? []}
            sizeChart={product.size_chart ?? null}
          />
        </div>

        {compact ? null : (
          <div className="mt-6 text-gray-900">
            <ProductReviewsSection
              itemId={product.id}
              onRated={(avg, count) => {
                setRatingAvg(avg);
                setRatingCount(count);
              }}
            />
          </div>
        )}

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
