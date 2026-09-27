'use client';

import { X, Plus, Minus } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useCallback, useEffect, useState } from 'react';
import type { StoreProduct } from './StoreProductCard';
import clsx from 'clsx';
import { StoreKhatarioProductView } from './StoreKhatarioProductView';
import { StoreProductGallery } from './StoreProductGallery';
import { chowkInkOn, chowkOnAccent, isKhatarioPack, isStudioPack, sanitizeStoreTheme, sectionEnabled, storeCanvas, storePackClass } from '@/lib/store/store-theme';
import { storeDiscountPercent } from '@/lib/store/map-store-product';

interface StoreProductDetailModalProps {
  product: StoreProduct;
  onClose: () => void;
}

export function StoreProductDetailModal({
  product,
  onClose,
}: StoreProductDetailModalProps) {
  const { cart, addToCart, updateCartQuantity, store } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const grocery = theme.pack === 'grocery' || isStudioPack(theme);
  const paper = storeCanvas(theme);
  const accent = theme.accent;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    product.variants[0]?.id ?? null,
  );

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId);
  const displayPrice = selectedVariant?.selling_price ?? product.selling_price;
  const displayStock = selectedVariant?.current_stock ?? product.current_stock;
  const outOfStock = displayStock <= 0;
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
      <div className={clsx('fixed inset-0 z-50 flex items-end justify-center sm:items-center', storePackClass(theme))} style={{ color: ink }}>
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
          <div className={clsx('relative max-h-[48vh] w-full', grocery && 'bg-white')}>
            {(product.images?.length ? product.images : product.image_url ? [product.image_url] : []).length ? (
              <StoreProductGallery
                images={product.images?.length ? product.images : product.image_url ? [product.image_url] : []}
                alt={product.name}
                accent={accent}
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
            {product.description ? (
              <p className="mt-3 text-[13px] leading-relaxed" style={{ opacity: 0.62 }}>
                {product.description}
              </p>
            ) : null}

            {product.has_variants && product.variants.length > 0 ? (
              <div className="mt-5">
                <p className="mb-2 text-[12px]" style={{ opacity: 0.5 }}>
                  Options
                </p>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVariantId(v.id)}
                      disabled={v.current_stock <= 0}
                      className="min-h-11 border px-3 text-[13px] disabled:opacity-40"
                      style={{
                        borderColor: v.id === selectedVariantId ? ink : `color-mix(in srgb, ${ink} 18%, transparent)`,
                        color: ink,
                      }}
                    >
                      {v.variant_name}
                      <span className="ml-1.5 tabular-nums" style={{ opacity: 0.55 }}>
                        ₹{v.selling_price.toLocaleString('en-IN')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-6">
              {outOfStock ? (
                <p className="py-3 text-[13px]" style={{ opacity: 0.5 }}>
                  Out of stock
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
          </div>
        </div>
      </div>
    );
}
