'use client';

import { Plus, Minus, Package } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, chowkOnAccent, isAtelierPack, isChowkPack, sanitizeStoreTheme } from '@/lib/store/store-theme';
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
  const onAccent = chowkOnAccent(accent);
  if (outOfStock) {
    return (
      <span
        className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px]"
        style={{ color: ink, opacity: 0.7 }}
      >
        Out
      </span>
    );
  }
  const open = inCart > 0 && !hasVariants;
  if (!open) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full shadow-sm"
        style={{ backgroundColor: accent, color: onAccent }}
        aria-label={hasVariants ? 'Choose options' : 'Add to bag'}
      >
        <Plus className="h-4 w-4" strokeWidth={2.4} />
      </button>
    );
  }
  return (
    <div
      className="absolute bottom-2 right-2 flex h-8 items-center rounded-full shadow-sm"
      style={{ backgroundColor: accent, color: onAccent }}
    >
      <button
        type="button"
        onClick={onDec}
        className="flex h-8 w-8 items-center justify-center"
        aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[1.1rem] text-center text-[12px] font-semibold tabular-nums" aria-live="polite" aria-atomic="true">
        {inCart}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={!canInc}
        className="flex h-8 w-8 items-center justify-center disabled:opacity-40"
        aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
      </button>
    </div>
  );
}

function AtelierAddControl({
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
  const onAccent = chowkOnAccent(accent);
  if (outOfStock) {
    return (
      <span
        className="pointer-events-none absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[10px]"
        style={{ backgroundColor: paper, color: ink, opacity: 0.7 }}
      >
        Out
      </span>
    );
  }
  const open = inCart > 0 && !hasVariants;
  if (!open) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="absolute bottom-3 right-3 rounded-full px-3 py-1.5 text-[11px] font-medium shadow-sm"
        style={{ backgroundColor: accent, color: onAccent }}
        aria-label={hasVariants ? 'Choose options' : 'Add to bag'}
      >
        + Add
      </button>
    );
  }
  return (
    <div
      className="absolute bottom-3 right-3 flex h-8 items-center rounded-full shadow-sm"
      style={{ backgroundColor: accent, color: onAccent }}
    >
      <button type="button" onClick={onDec} className="flex h-8 w-8 items-center justify-center" aria-label="Decrease quantity">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[1.1rem] text-center text-[12px] font-semibold tabular-nums" aria-live="polite">
        {inCart}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={!canInc}
        className="flex h-8 w-8 items-center justify-center disabled:opacity-40"
        aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
      </button>
    </div>
  );
}
  const { cart, addToCart, updateCartQuantity, store } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const atelier = isAtelierPack(theme);
  const layout: StoreProductCardVariant =
    variant ?? (isChowkPack(theme) || atelier ? 'grid' : 'classic');

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
          atelier ? 'bg-[#eee8e0]' : 'bg-white',
          layout === 'featured'
            ? 'aspect-[4/3] min-h-[200px] md:min-h-[280px] md:aspect-auto md:h-full'
            : atelier
              ? 'aspect-[3/4] rounded-[1.35rem]'
              : 'aspect-square',
        )}
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
              className={clsx(
                'h-full w-full',
                atelier ? 'atelier-product-img object-cover' : 'chowk-product-img object-contain p-2',
              )}
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: atelier ? '#eee8e0' : '#f3ebe0' }}>
              <span className={clsx(atelier ? 'font-atelier-display text-5xl' : 'font-chowk-display text-4xl leading-none')} style={{ color: ink, opacity: 0.28 }}>
                {product.name.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
        </Link>
        {discount > 0 ? (
          <span
            className="pointer-events-none absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
            style={{ backgroundColor: accent, color: chowkOnAccent(accent) }}
          >
            {discount}%
          </span>
        ) : null}
        {atelier ? (
          <AtelierAddControl
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
        ) : (
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
        )}
      </div>
    );

    const meta = (
      <div className={clsx(layout === 'featured' ? 'flex flex-col justify-center px-5 py-6 md:px-10' : atelier ? 'px-0.5 pb-1 pt-3' : 'px-2.5 pb-3 pt-2')}>
        {layout === 'featured' ? (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: accent }}>
            Popular
          </p>
        ) : null}
        <Link href={`/products/${product.id}`}>
          <h3
            className={clsx(
              'chowk-name line-clamp-2 font-medium',
              layout === 'featured' ? 'text-[17px] leading-snug sm:text-xl' : atelier ? 'min-h-[2.4em] text-[13px] leading-[1.35] font-normal' : 'min-h-[2.5em] text-[12px] leading-[1.3] sm:text-[13px]',
              layout === 'shelf' && 'min-h-0 line-clamp-2',
            )}
            style={{ color: ink }}
          >
            {product.name}
          </h3>
        </Link>
        {layout === 'featured' && excerpt ? (
          <p className="mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: ink, opacity: 0.55 }}>
            {excerpt}
            {product.description && product.description.trim().length > 140 ? '…' : ''}
          </p>
        ) : null}
        <p className={clsx('mt-1 flex flex-wrap items-baseline gap-x-1.5')}>
          <span className="text-[16px] font-semibold tabular-nums" style={{ color: ink }}>
            ₹{product.selling_price.toLocaleString('en-IN')}
          </span>
          {product.mrp && product.mrp > product.selling_price ? (
            <span className="text-[11px] tabular-nums line-through" style={{ color: ink, opacity: 0.38 }}>
              ₹{product.mrp.toLocaleString('en-IN')}
            </span>
          ) : null}
        </p>
        {product.unit ? (
          <p className="chowk-unit mt-0.5 text-[11px]" style={{ color: ink, opacity: 0.45 }}>
            {product.unit}
          </p>
        ) : null}
      </div>
    );

    if (layout === 'featured') {
      return (
        <article className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div className="grid md:grid-cols-2">
            {imageBlock}
            {meta}
          </div>
        </article>
      );
    }

    return (
      <article
        className={clsx(
          'overflow-hidden rounded-2xl bg-white shadow-sm',
          layout === 'shelf' && 'w-[42vw] max-w-[12.5rem] flex-shrink-0 snap-start sm:w-44',
          atelier && 'rounded-[1.35rem] bg-transparent shadow-none',
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
