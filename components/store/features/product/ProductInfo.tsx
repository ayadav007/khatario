'use client';

import { useMemo } from 'react';
import { Heart, Minus, Plus } from 'lucide-react';
import clsx from 'clsx';
import { StoreStars } from '@/components/store/StoreStars';
import { VariantPicker } from './VariantPicker';
import { findVariant, productOffer, toVariantInputs, type StoreProductDetail } from './product-view';

type Props = {
  product: StoreProductDetail;
  variantId: string | null;
  onVariantChange: (variantId: string | null) => void;
  /** Quantity of this item + variant in the cart (0 when not in it). */
  quantity: number;
  onQuantity: (quantity: number) => void;
  onAdd: () => void;
  inCart: boolean;
  favorite: boolean;
  onToggleFavorite: () => void;
  rating: { avg: number; count: number; onRate?: (n: number) => void };
};

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** Title, brand, price, rating, options, quantity, add to cart and wishlist. */
export function ProductInfo({
  product,
  variantId,
  onVariantChange,
  quantity,
  onQuantity,
  onAdd,
  inCart,
  favorite,
  onToggleFavorite,
  rating,
}: Props) {
  const variants = useMemo(() => toVariantInputs(product.variants), [product.variants]);
  const variant = findVariant(variants, variantId);
  const offer = productOffer(product, variant, variants.length);
  const needsVariant = product.has_variants && variants.length > 0;
  const soldOut = offer.stock <= 0 && (!needsVariant || variant != null);
  const meta = [product.category_name, product.unit].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      <div>
        {product.brand ? (
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{product.brand}</p>
        ) : null}
        <h1 className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">{product.name}</h1>
        {meta ? <p className="mt-1 text-sm opacity-60">{meta}</p> : null}
        <div className="mt-2">
          <StoreStars value={rating.avg} count={rating.count} size="md" onRate={rating.onRate} />
        </div>
      </div>

      <div>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-3xl font-bold tabular-nums">{inr(offer.price)}</span>
          {offer.mrp ? (
            <>
              <span className="text-sm tabular-nums line-through opacity-50">
                <span className="sr-only">MRP </span>
                {inr(offer.mrp)}
              </span>
              <span className="text-sm font-semibold text-[var(--primary)]">{offer.percentOff}% off</span>
            </>
          ) : null}
        </p>
        {product.tax_rate > 0 ? (
          <p className="mt-1 text-xs opacity-60">
            GST {product.tax_rate}%{product.gst_included ? ' included' : ' extra'}
          </p>
        ) : null}
      </div>

      {needsVariant ? <VariantPicker variants={variants} value={variantId} onChange={onVariantChange} /> : null}

      <div className="flex items-stretch gap-3">
        {inCart && quantity > 0 ? (
          <div className="inline-flex min-h-12 items-center rounded-lg border" style={{ borderColor: 'color-mix(in srgb, currentColor 20%, transparent)' }}>
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center"
              aria-label="Decrease quantity"
              onClick={() => onQuantity(quantity - 1)}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[2rem] text-center font-medium tabular-nums" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center disabled:opacity-40"
              aria-label="Increase quantity"
              disabled={quantity >= offer.stock}
              onClick={() => onQuantity(quantity + 1)}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!offer.canAdd}
            onClick={onAdd}
            className={clsx(
              'min-h-12 flex-1 rounded-lg px-6 text-sm font-semibold sm:flex-none sm:px-10',
              offer.canAdd
                ? 'bg-[var(--primary)] text-[var(--on-primary,#fff)]'
                : 'cursor-not-allowed bg-gray-200 text-gray-500',
            )}
          >
            {soldOut ? 'Out of stock' : offer.canAdd ? 'Add to cart' : 'Choose an option'}
          </button>
        )}
        <button
          type="button"
          aria-pressed={favorite}
          aria-label={favorite ? 'Remove from wishlist' : 'Save to wishlist'}
          onClick={onToggleFavorite}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border"
          style={{ borderColor: 'color-mix(in srgb, currentColor 20%, transparent)' }}
        >
          <Heart
            className={clsx('h-5 w-5', favorite ? 'fill-[var(--primary)] text-[var(--primary)]' : 'opacity-60')}
          />
        </button>
      </div>
    </div>
  );
}
