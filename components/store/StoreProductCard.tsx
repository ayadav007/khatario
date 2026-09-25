'use client';

import { Plus, Minus, Package } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, chowkOnAccent, isChowkPack, sanitizeStoreTheme } from '@/lib/store/store-theme';
import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

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

export type StoreProductCardVariant = 'classic' | 'grid' | 'shelf' | 'featured';

interface StoreProductCardProps {
  product: StoreProduct;
  onViewDetail?: (product: StoreProduct) => void;
  variant?: StoreProductCardVariant;
}

function ChowkAddControl({
  accent,
  paper,
  ink,
  outOfStock,
  inCart,
  hasVariants,
  canInc,
  onAdd,
  onInc,
  onDec,
}: {
  accent: string;
  paper: string;
  ink: string;
  outOfStock: boolean;
  inCart: number;
  hasVariants: boolean;
  canInc: boolean;
  onAdd: (e: React.MouseEvent) => void;
  onInc: (e: React.MouseEvent) => void;
  onDec: (e: React.MouseEvent) => void;
}) {
  const hair = `1px solid color-mix(in srgb, ${ink} 20%, transparent)`;
  if (outOfStock) {
    return (
      <span
        className="pointer-events-none absolute bottom-1.5 right-1.5 text-[10px] leading-none"
        style={{ color: ink, opacity: 0.55 }}
      >
        Out
      </span>
    );
  }
  const open = inCart > 0 && !hasVariants;
  return (
    <div
      className="chowk-add-shell absolute bottom-1.5 right-1.5 flex h-11 overflow-hidden"
      data-open={open ? 'true' : 'false'}
      style={{
        backgroundColor: paper,
        border: hair,
      }}
    >
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        onClick={onDec}
        className="flex h-11 w-11 shrink-0 items-center justify-center"
        style={{ color: ink, opacity: open ? 1 : 0 }}
        aria-hidden={!open}
        aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span
        className="flex h-11 min-w-[1.5rem] items-center justify-center text-[13px] font-medium tabular-nums"
        style={{ color: ink, opacity: open ? 1 : 0 }}
        aria-live="polite"
        aria-atomic="true"
      >
        {open ? inCart : ''}
      </span>
      <button
        type="button"
        onClick={open ? onInc : onAdd}
        disabled={open && !canInc}
        className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40"
        style={{ color: open ? ink : accent }}
        aria-label={open ? 'Increase quantity' : hasVariants ? 'Choose options' : 'Add to bag'}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function StoreProductCard({ product, onViewDetail, variant }: StoreProductCardProps) {
  const { cart, addToCart, updateCartQuantity, store } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const layout: StoreProductCardVariant =
    variant ?? (isChowkPack(theme) ? 'grid' : 'classic');

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

  if (layout !== 'classic') {
    const paper = theme.background;
    const ink = chowkInkOn(paper);
    const excerpt = (product.description || '').trim().slice(0, 140);
    const imageBlock = (
      <div
        className={clsx(
          'relative overflow-hidden',
          layout === 'featured' ? 'aspect-[4/5] min-h-[240px] md:min-h-[380px] md:aspect-auto md:h-full' : 'aspect-square',
        )}
        style={{ backgroundColor: paper }}
      >
        <Link
          href={`/products/${product.id}`}
          className={clsx('block h-full w-full', outOfStock && 'opacity-40')}
        >
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.name}
              className="chowk-product-img h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="chowk-missing font-chowk-display text-5xl leading-none" style={{ color: ink, opacity: 0.28 }}>
                {product.name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
        </Link>
        {discount > 0 ? (
          <span
            className="pointer-events-none absolute left-0 top-0 px-1.5 py-0.5 text-[10px] tabular-nums"
            style={{ backgroundColor: accent, color: chowkOnAccent(accent) }}
          >
            {discount}%
          </span>
        ) : null}
        <ChowkAddControl
          accent={accent}
          paper={paper}
          ink={ink}
          outOfStock={outOfStock}
          inCart={inCart}
          hasVariants={product.has_variants}
          canInc={!!cartItem && cartItem.quantity < cartItem.maxStock}
          onAdd={handleAdd}
          onInc={handleIncrement}
          onDec={handleDecrement}
        />
      </div>
    );

    const meta = (
      <div className={clsx(layout === 'featured' ? 'flex flex-col justify-center px-5 py-8 md:px-12 md:py-10' : 'pt-1.5')}>
        {layout === 'featured' ? (
          <p className="font-chowk-display mb-3 text-[22px] leading-none" style={{ color: ink }}>
            From the counter
          </p>
        ) : null}
        <Link href={`/products/${product.id}`}>
          <h3
            className={clsx(
              'chowk-name line-clamp-2 font-normal',
              layout === 'featured' ? 'text-[17px] leading-snug sm:text-xl' : 'min-h-[2.7em] text-[12px] leading-[1.35] sm:text-[13px]',
              layout === 'shelf' && 'min-h-0 line-clamp-1',
            )}
            style={{ color: ink, opacity: layout === 'featured' ? 1 : 0.82 }}
          >
            {product.name}
          </h3>
        </Link>
        {layout === 'featured' && excerpt ? (
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed" style={{ color: ink, opacity: 0.55 }}>
            {excerpt}
            {product.description && product.description.trim().length > 140 ? '…' : ''}
          </p>
        ) : null}
        <p className={clsx('flex flex-wrap items-baseline gap-x-1.5', layout === 'featured' ? 'mt-5' : 'mt-1')}>
          <span className="text-[15px] font-medium tabular-nums sm:text-[16px]" style={{ color: ink }}>
            ₹{product.selling_price.toLocaleString('en-IN')}
          </span>
          {product.mrp && product.mrp > product.selling_price ? (
            <span className="text-[11px] tabular-nums line-through" style={{ color: ink, opacity: 0.38 }}>
              ₹{product.mrp.toLocaleString('en-IN')}
            </span>
          ) : null}
          {product.unit ? (
            <span className="chowk-unit text-[11px]" style={{ color: ink, opacity: 0.38 }}>
              {product.unit}
            </span>
          ) : null}
        </p>
      </div>
    );

    if (layout === 'featured') {
      return (
        <article className="grid md:grid-cols-2" style={{ backgroundColor: 'transparent' }}>
          {imageBlock}
          {meta}
        </article>
      );
    }

    return (
      <article
        className={clsx(
          layout === 'shelf' && 'w-[46vw] max-w-[13.5rem] flex-shrink-0 snap-start sm:w-52',
        )}
      >
        {imageBlock}
        {meta}
      </article>
    );
  }

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
