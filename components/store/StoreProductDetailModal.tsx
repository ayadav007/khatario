'use client';

import { X, Plus, Minus, Package } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useCallback, useState } from 'react';
import type { StoreProduct } from './StoreProductCard';
import clsx from 'clsx';

interface StoreProductDetailModalProps {
  product: StoreProduct;
  onClose: () => void;
}

export function StoreProductDetailModal({
  product,
  onClose,
}: StoreProductDetailModalProps) {
  const { cart, addToCart, updateCartQuantity } = useStore();
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-gray-600 shadow backdrop-blur-sm hover:bg-white"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Image */}
        <div className="relative h-56 w-full bg-gray-100">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Package className="h-16 w-16 text-gray-300" />
            </div>
          )}
        </div>

        {/* Details */}
        <div className="px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{product.name}</h2>
          {product.category_name ? (
            <p className="mt-0.5 text-xs text-gray-400">{product.category_name}</p>
          ) : null}

          {product.description ? (
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              {product.description}
            </p>
          ) : null}

          {/* Price */}
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
                  {Math.round(
                    ((product.mrp - displayPrice) / product.mrp) * 100,
                  )}
                  % off
                </span>
              </>
            ) : null}
          </div>

          {product.unit !== 'PCS' ? (
            <p className="mt-1 text-xs text-gray-400">per {product.unit}</p>
          ) : null}

          {/* Variants */}
          {product.has_variants && product.variants.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Options
              </p>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariantId(v.id)}
                    className={clsx(
                      'rounded-lg border px-3 py-2 text-sm transition-colors',
                      v.id === selectedVariantId
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300',
                      v.current_stock <= 0 && 'opacity-40 cursor-not-allowed',
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

          {/* Stock indicator */}
          {displayStock > 0 && displayStock <= 5 ? (
            <p className="mt-3 text-xs text-amber-600">
              Only {displayStock} left in stock
            </p>
          ) : null}

          {/* Add to cart */}
          <div className="mt-5">
            {outOfStock ? (
              <div className="rounded-xl bg-gray-100 py-3.5 text-center text-sm font-medium text-gray-400">
                Out of stock
              </div>
            ) : cartItem ? (
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() =>
                    updateCartQuantity(
                      product.id,
                      selectedVariantId ?? undefined,
                      cartItem.quantity - 1,
                    )
                  }
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-green-600 text-green-600"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-lg font-bold text-green-700">
                  {cartItem.quantity}
                </span>
                <button
                  onClick={() =>
                    updateCartQuantity(
                      product.id,
                      selectedVariantId ?? undefined,
                      cartItem.quantity + 1,
                    )
                  }
                  disabled={cartItem.quantity >= displayStock}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-600 text-white disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
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
