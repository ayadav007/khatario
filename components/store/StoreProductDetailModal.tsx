'use client';

import { X, Plus, Minus, Package } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useCallback, useEffect, useState } from 'react';
import type { StoreProduct } from './StoreProductCard';
import clsx from 'clsx';
import { chowkInkOn, chowkOnAccent, isAtelierPack, isChowkPack, sanitizeStoreTheme, storeCanvas } from '@/lib/store/store-theme';

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
  const chowk = isChowkPack(theme);
  const atelier = isAtelierPack(theme);
  const pack = chowk || atelier;
  const paper = storeCanvas(theme);
  const accent = theme.accent;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    product.variants[0]?.id ?? null,
  );

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId);
  const displayPrice = selectedVariant?.selling_price ?? product.selling_price;
  const displayStock = selectedVariant?.current_stock ?? product.current_stock;
  const outOfStock = displayStock <= 0;

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

  if (pack) {
    const ink = chowkInkOn(paper);
    const hair = `1px solid color-mix(in srgb, ${ink} 14%, transparent)`;
    return (
      <div className={clsx('fixed inset-0 z-50 flex items-end justify-center sm:items-center', chowk && 'store-chowk', atelier && 'store-atelier')} style={{ color: ink }}>
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
            className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center"
            aria-label="Close"
            style={{ backgroundColor: paper }}
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <div className={clsx('relative w-full max-h-[48vh]', atelier ? 'aspect-[3/4]' : 'aspect-[4/5]')}>
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className={atelier ? 'font-atelier-display text-6xl' : 'font-chowk-display text-6xl'} style={{ opacity: 0.25 }}>
                  {product.name.slice(0, 1).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <div className="px-5 py-5">
            <h2 id="chowk-product-title" className={atelier ? 'font-atelier-display text-[1.55rem] leading-snug' : 'text-[1.15rem] leading-snug'}>
              {product.name}
            </h2>
            {product.unit ? (
              <p className="mt-1 text-[12px]" style={{ opacity: 0.45 }}>
                {product.unit}
                {product.category_name ? ` · ${product.category_name}` : ''}
              </p>
            ) : null}
            <p className="mt-3 text-[1.35rem] font-medium tabular-nums">
              ₹{displayPrice.toLocaleString('en-IN')}
              {product.mrp && product.mrp > displayPrice ? (
                <span className="ml-2 text-[13px] font-normal line-through" style={{ opacity: 0.4 }}>
                  ₹{product.mrp.toLocaleString('en-IN')}
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
                <div className="inline-flex items-center" style={{ border: hair }}>
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
                  className={clsx('min-h-12 w-full py-3.5 text-[14px] font-medium', atelier && 'rounded-2xl')}
                  style={{ backgroundColor: accent, color: chowkOnAccent(accent) }}
                >
                  {atelier ? 'Add to Bag' : 'Add to bag'} · ₹{displayPrice.toLocaleString('en-IN')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-gray-600 shadow backdrop-blur-sm hover:bg-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative h-56 w-full bg-gray-100">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Package className="h-16 w-16 text-gray-300" />
            </div>
          )}
        </div>

        <div className="px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{product.name}</h2>
          {product.category_name ? (
            <p className="mt-0.5 text-xs text-gray-400">{product.category_name}</p>
          ) : null}

          {product.description ? (
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{product.description}</p>
          ) : null}

          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xl font-bold text-gray-900">
              &#x20B9;{displayPrice.toLocaleString('en-IN')}
            </span>
            {product.mrp && product.mrp > displayPrice ? (
              <>
                <span className="text-sm text-gray-400 line-through">
                  &#x20B9;{product.mrp.toLocaleString('en-IN')}
                </span>
                <span className="text-xs font-semibold text-green-600">
                  {Math.round(((product.mrp - displayPrice) / product.mrp) * 100)}% off
                </span>
              </>
            ) : null}
          </div>

          {product.unit !== 'PCS' ? (
            <p className="mt-1 text-xs text-gray-400">per {product.unit}</p>
          ) : null}

          {product.has_variants && product.variants.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Options</p>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVariantId(v.id)}
                    className={clsx(
                      'rounded-lg border px-3 py-2 text-sm transition-colors',
                      v.id === selectedVariantId
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
                      v.current_stock <= 0 && 'cursor-not-allowed opacity-40',
                    )}
                    disabled={v.current_stock <= 0}
                  >
                    <span className="font-medium">{v.variant_name}</span>
                    <span className="ml-1.5 text-xs opacity-70">
                      &#x20B9;{v.selling_price.toLocaleString('en-IN')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {displayStock > 0 && displayStock <= 5 ? (
            <p className="mt-3 text-xs text-amber-600">Only {displayStock} left in stock</p>
          ) : null}

          <div className="mt-5">
            {outOfStock ? (
              <div className="rounded-xl bg-gray-100 py-3.5 text-center text-sm font-medium text-gray-400">
                Out of stock
              </div>
            ) : cartItem ? (
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    updateCartQuantity(product.id, selectedVariantId ?? undefined, cartItem.quantity - 1)
                  }
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-green-600 text-green-600"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-lg font-bold text-green-700">{cartItem.quantity}</span>
                <button
                  type="button"
                  onClick={() =>
                    updateCartQuantity(product.id, selectedVariantId ?? undefined, cartItem.quantity + 1)
                  }
                  disabled={cartItem.quantity >= displayStock}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-600 text-white disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleAdd}
                className="w-full rounded-xl bg-green-600 py-3.5 text-center text-sm font-semibold text-white transition-colors hover:bg-green-700"
              >
                Add to Cart &middot; &#x20B9;{displayPrice.toLocaleString('en-IN')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
