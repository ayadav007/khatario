'use client';

import { Plus, Minus, Package } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useCallback, useMemo } from 'react';

export interface StoreProduct {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  selling_price: number;
  mrp: number | null;
  unit: string;
  image_url: string | null;
  category_id: string | null;
  category_name: string | null;
  current_stock: number;
  has_variants: boolean;
  tax_rate: number;
  variants: Array<{
    id: string;
    variant_name: string;
    selling_price: number;
    current_stock: number;
    attributes: unknown;
  }>;
}

interface StoreProductCardProps {
  product: StoreProduct;
  onViewDetail?: (product: StoreProduct) => void;
}

export function StoreProductCard({ product, onViewDetail }: StoreProductCardProps) {
  const { cart, addToCart, updateCartQuantity } = useStore();

  const inCart = useMemo(() => {
    if (product.has_variants) {
      return product.variants.reduce((sum, v) => {
        const found = cart.find(
          (c) => c.itemId === product.id && c.variantId === v.id,
        );
        return sum + (found?.quantity ?? 0);
      }, 0);
    }
    return cart.find((c) => c.itemId === product.id && !c.variantId)?.quantity ?? 0;
  }, [cart, product]);

  const cartItem = useMemo(() => {
    if (product.has_variants) return null;
    return cart.find((c) => c.itemId === product.id && !c.variantId) ?? null;
  }, [cart, product]);

  const outOfStock = product.current_stock <= 0 && !product.has_variants;
  const discount =
    product.mrp && product.mrp > product.selling_price
      ? Math.round(((product.mrp - product.selling_price) / product.mrp) * 100)
      : 0;

  const handleAdd = useCallback(() => {
    if (product.has_variants) {
      onViewDetail?.(product);
      return;
    }
    addToCart({
      itemId: product.id,
      name: product.name,
      price: product.selling_price,
      quantity: 1,
      imageUrl: product.image_url ?? undefined,
      unit: product.unit,
      maxStock: product.current_stock,
    });
  }, [product, addToCart, onViewDetail]);

  const handleIncrement = useCallback(() => {
    if (!cartItem) return;
    updateCartQuantity(product.id, undefined, cartItem.quantity + 1);
  }, [product.id, cartItem, updateCartQuantity]);

  const handleDecrement = useCallback(() => {
    if (!cartItem) return;
    updateCartQuantity(product.id, undefined, cartItem.quantity - 1);
  }, [product.id, cartItem, updateCartQuantity]);

  return (
    <div className="flex gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
      {/* Image */}
      <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="h-8 w-8 text-gray-300" />
          </div>
        )}
        {discount > 0 ? (
          <span className="absolute left-1 top-1 rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {discount}% OFF
          </span>
        ) : null}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col justify-between">
        <div>
          <h3
            className="line-clamp-2 text-sm font-medium text-gray-900 cursor-pointer hover:underline"
            onClick={() => onViewDetail?.(product)}
          >
            {product.name}
          </h3>
          {product.unit !== 'PCS' ? (
            <p className="mt-0.5 text-xs text-gray-400">per {product.unit}</p>
          ) : null}
        </div>

        <div className="flex items-end justify-between">
          <div>
            <span className="text-base font-bold text-gray-900">
              &#x20B9;{product.selling_price.toLocaleString('en-IN')}
            </span>
            {product.mrp && product.mrp > product.selling_price ? (
              <span className="ml-1.5 text-xs text-gray-400 line-through">
                &#x20B9;{product.mrp.toLocaleString('en-IN')}
              </span>
            ) : null}
          </div>

          {/* Add / Qty control */}
          {outOfStock ? (
            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-400">
              Out of stock
            </span>
          ) : inCart > 0 && !product.has_variants ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleDecrement}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-green-600 text-green-600"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-6 text-center text-sm font-semibold text-green-700">
                {inCart}
              </span>
              <button
                onClick={handleIncrement}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleAdd}
              className="rounded-lg border border-green-600 px-4 py-1.5 text-sm font-semibold text-green-600 transition-colors hover:bg-green-50"
            >
              {product.has_variants ? 'Options' : 'ADD'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
