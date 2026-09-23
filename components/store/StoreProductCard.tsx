'use client';

import { Plus, Minus, Package } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { useCallback, useMemo } from 'react';
import Link from 'next/link';

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
  gst_included?: boolean;
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
  const { cart, addToCart, updateCartQuantity, store } = useStore();
  const accent = (store?.store_theme?.accent as string) || '#16a34a';

  const inCart = useMemo(() => {
    if (product.has_variants) {
      return product.variants.reduce((sum, v) => {
        const found = cart.find((c) => c.itemId === product.id && c.variantId === v.id);
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

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
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
        taxRate: product.tax_rate,
      });
    },
    [product, addToCart, onViewDetail],
  );

  const handleIncrement = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!cartItem) return;
      updateCartQuantity(product.id, undefined, cartItem.quantity + 1);
    },
    [product.id, cartItem, updateCartQuantity],
  );

  const handleDecrement = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!cartItem) return;
      updateCartQuantity(product.id, undefined, cartItem.quantity - 1);
    },
    [product.id, cartItem, updateCartQuantity],
  );

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <Link href={`/products/${product.id}`} className="relative block aspect-square bg-gray-50">
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
            <Package className="h-10 w-10 text-gray-300" />
          </div>
        )}
        {discount > 0 ? (
          <span
            className="absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            {discount}% OFF
          </span>
        ) : null}
        {outOfStock ? (
          <span className="absolute inset-x-2 bottom-2 rounded bg-white/90 px-2 py-0.5 text-center text-[10px] font-medium text-gray-500">
            Out of stock
          </span>
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col p-2.5">
        <Link href={`/products/${product.id}`}>
          <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-5 text-gray-900">
            {product.name}
          </h3>
        </Link>
        <p className="mt-0.5 text-xs text-gray-400">{product.unit}</p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-900">
              ₹{product.selling_price.toLocaleString('en-IN')}
            </p>
            {product.mrp && product.mrp > product.selling_price ? (
              <p className="text-[11px] text-gray-400 line-through">
                ₹{product.mrp.toLocaleString('en-IN')}
              </p>
            ) : null}
          </div>

          {outOfStock ? null : inCart > 0 && !product.has_variants ? (
            <div className="flex items-center rounded-lg" style={{ backgroundColor: accent }}>
              <button
                type="button"
                onClick={handleDecrement}
                className="flex h-8 w-8 items-center justify-center text-white"
                aria-label="Decrease"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-5 text-center text-xs font-bold text-white">{inCart}</span>
              <button
                type="button"
                onClick={handleIncrement}
                className="flex h-8 w-8 items-center justify-center text-white"
                aria-label="Increase"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: accent, color: accent }}
            >
              {product.has_variants ? 'Options' : 'Add'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
