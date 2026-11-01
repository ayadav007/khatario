'use client';

import { X, Plus, Minus } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { StoreKhatarioProductView } from './StoreKhatarioProductView';
import { ProductGallery } from './features/product/ProductGallery';
import { ProductInfoTabs } from './features/product/ProductInfoTabs';
import { VariantPicker } from './features/product/VariantPicker';
import { findVariant, productOffer, toVariantInputs, type StoreProductDetail } from './features/product/product-view';
import { chowkInkOn, chowkOnAccent, isKhatarioPack, sanitizeStoreTheme, usesStudioSections, sectionEnabled, storeCanvas, storePackClass } from '@/lib/store/store-theme';
import { storeDiscountPercent } from '@/lib/store/map-store-product';
import { ReviewSummaryCompact } from './features/reviews/ReviewSummary';

/** Keeps the square gallery from growing the sheet: about half the screen on phones, 420 px wider. */
const MODAL_GALLERY_FIT =
  '[&_[aria-roledescription=carousel]]:max-h-[50vh] sm:[&_[aria-roledescription=carousel]]:max-h-[420px]';

interface StoreProductDetailModalProps {
  /** List items work too; the detail extras (video, tabs, size chart) are optional. */
  product: StoreProductDetail;
  onClose: () => void;
}

export function StoreProductDetailModal({
  product,
  onClose,
}: StoreProductDetailModalProps) {
  const { cart, addToCart, updateCartQuantity, store } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const grocery = theme.pack === 'grocery' || usesStudioSections(theme);
  const paper = storeCanvas(theme);
  const accent = theme.accent;
  const variants = useMemo(() => toVariantInputs(product.variants), [product.variants]);
  // VariantPicker preselects the first in-stock option on mount.
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  const selectedVariant = findVariant(variants, selectedVariantId);
  const offer = productOffer(product, selectedVariant, variants.length);
  const displayPrice = offer.price;
  const displayStock = offer.stock;
  const outOfStock = !offer.canAdd;
  const discount = sectionEnabled(theme, 'offers')
    ? storeDiscountPercent(product.mrp, displayPrice)
    : 0;

  const cartItem = cart.find(
    (c) =>
      c.itemId === product.id &&
      (product.has_variants ? c.variantId === selectedVariantId : !c.variantId),
  );

  const handleAdd = useCallback(() => {
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
    });
  }, [product, selectedVariantId, selectedVariant, displayPrice, displayStock, addToCart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (isKhatarioPack(theme)) {
    return (
      <div className="store-khatario fixed inset-0 z-50 flex items-end justify-center sm:items-center" style={{ color: '#171717' }}>
        <button type="button" className="chowk-scrim is-on absolute inset-0 border-0 bg-black/35 p-0" aria-label="Close" onClick={onClose} />
        <div
          className="chowk-sheet is-on relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-[#f4f5f7] sm:max-h-[88vh] sm:rounded-3xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chowk-product-title"
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow-sm"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StoreKhatarioProductView
              product={product}
              compact
              onRelatedOpen={(item) => {
                onClose();
                window.location.href = `/products/${item.id}`;
              }}
            />
          </div>
        </div>
      </div>
    );
  }

    const ink = chowkInkOn(paper);
    const hair = `1px solid color-mix(in srgb, ${ink} 14%, transparent)`;
    return (
      <div
        className={clsx('fixed inset-0 z-50 flex items-end justify-center sm:items-center', storePackClass(theme))}
        style={{
          color: ink,
          // Studio and Quick roots already carry these; the feature sections read them.
          ...(usesStudioSections(theme)
            ? {}
            : { ['--primary' as string]: accent, ['--on-primary' as string]: chowkOnAccent(accent), ['--paper' as string]: paper }),
        }}
      >
        <button type="button" className="chowk-scrim is-on absolute inset-0 border-0 bg-black/35 p-0" aria-label="Close" onClick={onClose} />
        <div
          className="chowk-sheet is-on relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl pb-[env(safe-area-inset-bottom,0px)] sm:max-h-[85vh] sm:rounded-3xl"
          style={{ backgroundColor: paper }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="chowk-product-title"
        >
          <button
            type="button"
            onClick={onClose}
            className={clsx('absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center', grocery && 'rounded-xl shadow-sm')}
            aria-label="Close"
            style={{ backgroundColor: paper }}
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
          {grocery && discount > 0 ? (
            <span className="absolute left-3 top-3 z-10 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-[#172019]">
              {discount}% OFF
            </span>
          ) : null}
          <div className={clsx('relative w-full', MODAL_GALLERY_FIT, grocery && 'bg-white')}>
            {(product.images?.length ? product.images : product.image_url ? [product.image_url] : []).length ||
            product.video_url ? (
              <ProductGallery
                images={product.images?.length ? product.images : product.image_url ? [product.image_url] : []}
                videoUrl={product.video_url}
                alt={product.name}
              />
            ) : (
              <div className="flex aspect-[4/5] w-full items-center justify-center">
                <span className="text-6xl font-semibold" style={{ opacity: 0.25 }}>
                  {product.name.slice(0, 1).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <div className="px-5 py-5">
            <h2 id="chowk-product-title" className="text-[1.15rem] leading-snug">
              {product.name}
            </h2>
            {product.unit ? (
              <p className="mt-1 text-[12px]" style={{ opacity: 0.45 }}>
                {product.unit}
                {product.category_name ? ` · ${product.category_name}` : ''}
              </p>
            ) : null}
            <p className={clsx('mt-3 text-[1.35rem] tabular-nums', grocery ? 'font-bold' : 'font-medium')} style={grocery ? { color: accent } : undefined}>
              ₹{displayPrice.toLocaleString('en-IN')}
              {discount > 0 && product.mrp != null ? (
                <span className="ml-2 text-[13px] font-normal line-through" style={{ opacity: 0.4 }}>
                  ₹{Number(product.mrp).toLocaleString('en-IN')}
                </span>
              ) : null}
            </p>
            <div className="mt-1">
              <ReviewSummaryCompact itemId={product.id} avg={product.rating_avg ?? 0} count={product.rating_count ?? 0} />
            </div>
            {product.has_variants && variants.length > 0 ? (
              <div className="mt-5">
                <VariantPicker variants={variants} value={selectedVariantId} onChange={setSelectedVariantId} />
              </div>
            ) : null}

            <div className="mt-6">
              {outOfStock ? (
                <p className="py-3 text-[13px]" style={{ opacity: 0.5 }}>
                  {offer.stock <= 0 && (selectedVariant || !(product.has_variants && variants.length > 0))
                    ? 'Out of stock'
                    : 'Choose an option'}
                </p>
              ) : cartItem ? (
                <div className={clsx('inline-flex items-center', grocery && 'rounded-xl')} style={{ border: hair }}>
                  <button
                    type="button"
                    onClick={() =>
                      updateCartQuantity(product.id, selectedVariantId ?? undefined, cartItem.quantity - 1)
                    }
                    className="flex h-12 w-12 items-center justify-center"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[2rem] text-center text-[15px] tabular-nums" aria-live="polite">
                    {cartItem.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateCartQuantity(product.id, selectedVariantId ?? undefined, cartItem.quantity + 1)
                    }
                    disabled={cartItem.quantity >= displayStock}
                    className="flex h-12 w-12 items-center justify-center disabled:opacity-40"
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAdd}
                  className={clsx('min-h-12 w-full py-3.5 text-[14px] font-medium', grocery && 'rounded-2xl font-semibold')}
                  style={{ backgroundColor: accent, color: chowkOnAccent(accent) }}
                >
                  {grocery ? 'Add to cart' : 'Add to bag'} · ₹{displayPrice.toLocaleString('en-IN')}
                </button>
              )}
            </div>
            <div className="mt-6">
              <ProductInfoTabs
                description={product.description}
                tabs={product.store_tabs ?? []}
                sizeChart={product.size_chart ?? null}
              />
            </div>
          </div>
        </div>
      </div>
    );
}
