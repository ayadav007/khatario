'use client';

import { Heart, Minus, Plus } from 'lucide-react';
import { StoreStars } from './StoreStars';
import { useStore } from '@/lib/store/store-context';
import { chowkInkOn, chowkOnAccent, hexLuminance, isKhatarioPack, sanitizeStoreTheme, sectionEnabled, storeCanvas } from '@/lib/store/store-theme';
import { lowStockCount, storeDiscountPercent } from '@/lib/store/map-store-product';
import { StudioAddButton, StudioProductTile } from './studio-theme/StudioSections';
import { useCallback, useMemo, useState } from 'react';
import { QuickVariantSheet } from './quick-theme/QuickSheets';
import { usePhoneSheets } from '@/lib/store/phone-kit';
import { useEngineCardLook } from './engine/EngineCardContext';
import { productCardLook } from '@/lib/store/engine/card-look';
import { isDesignedCard } from '@/lib/store/engine/card-render';
import { cardBadges } from '@/lib/store/engine/card-badges';
import { cardSizes } from '@/lib/store/engine/card-sizes';
import { cartLineFor, packPriceShowsMrp, packsLineOn, productCardPacks } from '@/lib/store/engine/card-packs';
import { initialVariantId } from './features/product/product-logic';
import { packLabelFromName } from '@/lib/store/unit-price';
import type { StoreVariantInput } from '@/lib/store/variant-options';
import type { StoreSwatch } from '@/lib/store/product-extras';
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
  brand?: string | null;
  current_stock: number;
  has_variants: boolean;
  tax_rate: number;
  gst_included?: boolean;
  images?: string[];
  rating_avg?: number;
  rating_count?: number;
  featured_in_store?: boolean;
  /** ISO time the item was added; drives the "New" badge. */
  created_at?: string | null;
  /** Units sold on the store; only filled when the list was sorted by best sellers. */
  sold_count?: number;
  seo_title?: string | null;
  seo_description?: string | null;
  seo_image_url?: string | null;
  store_badge?: string | null;
  store_tagline?: string | null;
  /** Fit advice shown under the size buttons on the product page. */
  store_fit_note?: string | null;
  store_swatches?: StoreSwatch[];
  /** False when the shop marked the product as not returnable online (treated as returnable when absent). */
  returnable?: boolean;
  variants: Array<{
    id: string;
    variant_name: string;
    selling_price: number;
    current_stock: number;
    attributes: unknown;
  }>;
}

export type StoreProductCardVariant = 'grid' | 'shelf' | 'featured';

interface StoreProductCardProps {
  product: StoreProduct;
  onViewDetail?: (product: StoreProduct) => void;
  variant?: StoreProductCardVariant;
  /** Studio: an extra badge from the section, e.g. "Bestseller". */
  highlight?: string;
  /** Studio: show the product's tagline / colour swatches; undefined follows the theme preset. */
  showTagline?: boolean;
  showSwatches?: boolean;
  /** A card with the `packs` line starts on this pack when the product has it (Buy again: the pack ordered before). */
  initialPackId?: string | null;
}

/** Items with options open a bottom-sheet picker on Quick and with the phone kit on phones. */
export function StoreProductCard(props: StoreProductCardProps) {
  const { store } = useStore();
  const look = productCardLook(useEngineCardLook(), sanitizeStoreTheme(store?.store_theme));
  const sheets = usePhoneSheets(look.sheetsTheme);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const picker = sheets && props.product.has_variants;
  return (
    <>
      <ProductCard {...props} onOptions={picker ? () => setOptionsOpen(true) : undefined} />
      {picker && optionsOpen ? (
        <QuickVariantSheet product={props.product} open onClose={() => setOptionsOpen(false)} />
      ) : null}
    </>
  );
}

function ChowkAddControl({
  accent,
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

function ProductCard({
  product,
  onViewDetail,
  variant,
  highlight,
  showTagline,
  showSwatches,
  initialPackId,
  onOptions,
}: StoreProductCardProps & { onOptions?: () => void }) {
  const { cart, addToCart, updateCartQuantity, store, favoriteIds, toggleFavorite } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const engineLook = useEngineCardLook();
  const look = productCardLook(engineLook, theme);
  const accent = theme.accent;
  const khatario = isKhatarioPack(theme);
  const quick = look.quick;
  const layout: StoreProductCardVariant = variant ?? 'grid';

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

  // The `packs` line of a card design: a product with exactly one option axis shows its packs (500 g / 1 kg / 5 kg) as
  // chips and adds the chosen pack itself, each pack its own cart line. Off, or with two axes, the card is as before.
  // (packsLineOn and productCardPacks are shared with the Buy again section, which needs the same answer.)
  const packsOn = look.studioTile && product.has_variants && packsLineOn(engineLook);
  const packChips = useMemo(
    () =>
      packsOn
        ? productCardPacks({ has_variants: true, selling_price: product.selling_price, variants: product.variants })
        : null,
    [packsOn, product.variants, product.selling_price],
  );
  const [chosenPackId, setChosenPackId] = useState<string | null>(null);
  // Starts on `initialPackId` when it is one of the chips, else on the product page's first choice (the first pack in
  // stock); one that is not a chip falls back to the first chip in stock.
  const pack = useMemo(() => {
    if (!packChips) return null;
    const { packs } = packChips;
    const start = initialVariantId(product.variants as StoreVariantInput[]);
    return (
      packs.find((p) => p.id === chosenPackId) ??
      (initialPackId ? packs.find((p) => p.id === initialPackId) : undefined) ??
      packs.find((p) => p.id === start) ??
      packs.find((p) => !p.soldOut) ??
      packs[0]
    );
  }, [packChips, chosenPackId, initialPackId, product.variants]);
  // The MRP belongs to the product's own price; a pack at another price shows none.
  const packMrp = pack && packPriceShowsMrp(pack.price, product.selling_price) ? product.mrp : null;
  const packLine = pack ? cartLineFor(cart, product.id, pack.id) ?? null : null;
  // The cart line the stepper controls: the chosen pack's, or the product's own when it has no options.
  const stepLine = pack ? packLine : cartItem;
  const stepVariantId = pack ? pack.id : undefined;

  const outOfStock = pack ? pack.soldOut : product.current_stock <= 0 && !product.has_variants;
  const shownPrice = pack ? pack.price : product.selling_price;
  const shownMrp = pack ? packMrp : product.mrp;
  // M6: on the new design the old Store editor's "Today's offers" and "Add to bag" switches no longer apply; the
  // card's own design and lines decide.
  const discount = engineLook || sectionEnabled(theme, 'offers')
    ? storeDiscountPercent(shownMrp, shownPrice)
    : 0;
  const listingAdd = engineLook ? true : theme.show_listing_add;

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (pack) {
        if (pack.soldOut) return;
        addToCart({
          itemId: product.id,
          variantId: pack.id,
          name: product.name,
          variantName: pack.label,
          price: pack.price,
          quantity: 1,
          imageUrl: product.image_url ?? undefined,
          unit: product.unit,
          maxStock: pack.stock,
          taxRate: product.tax_rate,
          mrp: packMrp != null && packMrp > pack.price ? packMrp : undefined,
        });
        return;
      }
      if (product.has_variants) {
        // The bottom-sheet picker (Quick, phone kit) instead of opening the product.
        if (onOptions) onOptions();
        else onViewDetail?.(product);
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
        mrp: product.mrp != null && product.mrp > product.selling_price ? product.mrp : undefined,
      });
    },
    [product, pack, packMrp, addToCart, onViewDetail, onOptions],
  );

  // Buy now, as on the product page (StoreKhatarioProductView.buyNow): put one in the cart unless it is already there, then
  // go to checkout. A product with options opens the option chooser first, as Add does.
  const handleBuy = useCallback(
    (e: React.MouseEvent) => {
      if (product.has_variants && !pack) {
        handleAdd(e);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (pack?.soldOut) return;
      if (!stepLine) handleAdd(e);
      window.location.href = '/checkout';
    },
    [product.has_variants, pack, stepLine, handleAdd],
  );

  const handleIncrement = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!stepLine) return;
      updateCartQuantity(product.id, stepVariantId, stepLine.quantity + 1);
    },
    [product.id, stepLine, stepVariantId, updateCartQuantity],
  );

  const handleDecrement = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!stepLine) return;
      updateCartQuantity(product.id, stepVariantId, stepLine.quantity - 1);
    },
    [product.id, stepLine, stepVariantId, updateCartQuantity],
  );

  if (look.studioTile) {
    // With pack chips the card's count, stepper and options are the chosen pack's alone.
    const tileInCart = pack ? packLine?.quantity ?? 0 : inCart;
    const tileOptions = product.has_variants && !pack;
    const open = tileInCart > 0 && !tileOptions;
    const add = !listingAdd ? null : open ? (
      <div className="stepper">
        <button type="button" onClick={handleDecrement} aria-label="Decrease quantity">
          <Minus strokeWidth={2.4} />
        </button>
        <b aria-live="polite">{tileInCart}</b>
        <button
          type="button"
          onClick={handleIncrement}
          disabled={!stepLine || stepLine.quantity >= stepLine.maxStock}
          aria-label="Increase quantity"
        >
          <Plus strokeWidth={2.4} />
        </button>
      </div>
    ) : (
      <StudioAddButton
        label={
          outOfStock
            ? quick
              ? 'Sold out'
              : 'Out of stock'
            : tileOptions
              ? quick
                ? `${product.variants.length} options`
                : 'Choose options'
              : quick
                ? 'ADD'
                : 'Add'
        }
        onClick={handleAdd}
        disabled={outOfStock}
      />
    );
    const { badges, hideDiscount } = cardBadges({
      customBadge: product.store_badge,
      highlight,
      createdAt: product.created_at,
      discountPct: discount,
    });
    // A card design decides its tagline and swatch lines itself (the section's switches are folded into its look).
    const designed = engineLook && isDesignedCard(engineLook.card) ? { look: engineLook.card, schemes: engineLook.schemes } : undefined;
    const tagline = designed ? product.store_tagline : (showTagline ?? engineLook?.tagline ?? false) ? product.store_tagline : null;
    const swatches = designed ? product.store_swatches : (showSwatches ?? engineLook?.swatches ?? false) ? product.store_swatches : undefined;
    // Size chips for the `sizes` line: only a product with options has sizes; one without a size option gets none.
    const sizeChips = product.has_variants ? cardSizes(product.variants as StoreVariantInput[]) : null;
    const gallery = product.images?.length ? product.images : product.image_url ? [product.image_url] : [];
    // A card design draws its own buttons from these (its button style, Buy now, the stepper); Theme's own gets none of it.
    const designedExtras = designed
      ? {
          card: designed,
          brand: product.brand,
          images: gallery,
          placeholderLogo: store?.logo_url ?? null,
          actions: add
            ? {
                inCart: tileInCart,
                hasOptions: tileOptions,
                canInc: !!stepLine && stepLine.quantity < stepLine.maxStock,
                onAdd: handleAdd,
                onBuy: handleBuy,
                onInc: handleIncrement,
                onDec: handleDecrement,
              }
            : undefined,
        }
      : {};
    const tile = (
      <StudioProductTile
        name={product.name}
        unit={product.has_variants ? `${product.variants.length} options` : product.unit}
        price={shownPrice}
        mrp={shownMrp}
        image={gallery[0] ?? product.image_url}
        hoverImage={gallery[1]}
        href={`/products/${product.id}`}
        discount={discount}
        hideDiscountBadge={hideDiscount}
        badges={badges}
        tagline={tagline}
        swatches={swatches}
        sizes={sizeChips?.sizes}
        moreSizes={sizeChips?.more}
        packs={packChips?.packs}
        morePacks={packChips?.more}
        packId={pack?.id}
        onPack={setChosenPackId}
        onMorePacks={onOptions}
        rating={product.rating_avg}
        ratingCount={product.rating_count}
        lowStock={pack ? lowStockCount({ current_stock: pack.stock }) : lowStockCount(product)}
        outOfStock={outOfStock}
        fav={favoriteIds.includes(product.id)}
        onFav={() => void toggleFavorite(product.id)}
        add={add}
        packLabel={pack ? pack.label : product.has_variants ? null : packLabelFromName(product.name)}
        {...designedExtras}
      />
    );
    return tile;
  }

  if (theme.pack === 'grocery') {
    const paper = storeCanvas(theme);
    const ink = chowkInkOn(paper);
    const dark = hexLuminance(paper) < 0.4;
    const onAccent = chowkOnAccent(accent);
    const fav = favoriteIds.includes(product.id);
    const open = inCart > 0 && !product.has_variants;
    return (
      <article
        className={clsx(
          'g-lift g-line g-surface group flex flex-col overflow-hidden rounded-[18px] border',
          layout === 'shelf' && 'w-[172px] shrink-0 sm:w-[210px]',
        )}
        style={{ color: ink }}
      >
        <div
          className="g-card-img aspect-[10/9]"
          style={{ backgroundColor: dark ? 'rgba(255,255,255,0.04)' : `color-mix(in srgb, ${accent} 6%, #ffffff)` }}
        >
          <Link href={`/products/${product.id}`} className={clsx('block h-full w-full', outOfStock && 'opacity-40')}>
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.image_url}
                alt={product.name}
                className={clsx('h-full w-full object-contain p-3', !dark && 'mix-blend-multiply')}
                loading="lazy"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-4xl font-black" style={{ color: accent, opacity: 0.3 }}>
                {product.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </Link>
          {discount > 0 ? (
            <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-extrabold text-[#172019]">
              {discount}% OFF
            </span>
          ) : null}
          <button
            type="button"
            className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm transition-transform hover:scale-110"
            aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void toggleFavorite(product.id);
            }}
          >
            <Heart className="h-4 w-4" style={{ color: fav ? '#e11d48' : '#68736b', fill: fav ? '#e11d48' : 'transparent' }} />
          </button>
        </div>
        <div className="flex flex-1 flex-col p-3 sm:p-3.5">
          <Link href={`/products/${product.id}`} className="line-clamp-2 min-h-[2.5em] text-[13.5px] font-bold leading-snug sm:text-[14.5px]">
            {product.name}
          </Link>
          <p className="mt-0.5 text-[12px]" style={{ opacity: 0.55 }}>
            {product.has_variants ? `${product.variants.length} options` : product.unit}
          </p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-[16px] font-extrabold tabular-nums sm:text-[17px]">₹{product.selling_price.toLocaleString('en-IN')}</span>
            {discount > 0 && product.mrp != null ? (
              <span className="text-[12px] line-through tabular-nums" style={{ opacity: 0.45 }}>
                ₹{Number(product.mrp).toLocaleString('en-IN')}
              </span>
            ) : null}
          </div>
          {listingAdd ? (
            <div className="mt-auto pt-3">
              {outOfStock ? (
                <span className="g-line flex h-10 w-full items-center justify-center rounded-xl border text-[12px] font-semibold" style={{ opacity: 0.5 }}>
                  Out of stock
                </span>
              ) : open ? (
                <div className="flex h-10 w-full items-center justify-between rounded-xl" style={{ backgroundColor: accent, color: onAccent }}>
                  <button type="button" onClick={handleDecrement} className="flex h-10 w-10 items-center justify-center" aria-label="Decrease quantity">
                    <Minus className="h-4 w-4" strokeWidth={2.4} />
                  </button>
                  <span className="text-[14px] font-extrabold tabular-nums" aria-live="polite">
                    {inCart}
                  </span>
                  <button
                    type="button"
                    onClick={handleIncrement}
                    disabled={!cartItem || cartItem.quantity >= cartItem.maxStock}
                    className="flex h-10 w-10 items-center justify-center disabled:opacity-40"
                    aria-label="Increase quantity"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.4} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAdd}
                  className="g-add flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border-[1.5px] text-[13px] font-bold hover:bg-[var(--store-accent)] hover:text-[var(--g-on)]"
                  style={{ borderColor: accent, color: accent, ['--g-on' as string]: onAccent }}
                >
                  <Plus className="h-4 w-4" strokeWidth={2.4} />
                  {product.has_variants ? 'Choose options' : 'Add to cart'}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  const paper = storeCanvas(theme);
  const ink = chowkInkOn(paper);
  const excerpt = (product.description || '').trim().slice(0, 140);
  const imageBlock = (
    <div
      className={clsx(
        'relative overflow-hidden bg-white',
        layout === 'featured'
          ? 'aspect-[4/3] min-h-[200px] md:min-h-[280px] md:aspect-auto md:h-full'
          : khatario && layout === 'shelf'
            ? 'aspect-[4/3]'
            : 'aspect-square',
      )}
    >
      <Link href={`/products/${product.id}`} className={clsx('block h-full w-full', outOfStock && 'opacity-40')}>
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.name}
            className="chowk-product-img h-full w-full object-contain p-2"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: '#f3ebe0' }}>
            <span className="text-4xl font-semibold leading-none" style={{ color: ink, opacity: 0.28 }}>
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
      <button
        type="button"
        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm"
        aria-label={favoriteIds.includes(product.id) ? 'Remove from favourites' : 'Add to favourites'}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void toggleFavorite(product.id);
        }}
      >
        <Heart
          className="h-4 w-4"
          style={{
            color: favoriteIds.includes(product.id) ? accent : ink,
            fill: favoriteIds.includes(product.id) ? accent : 'transparent',
          }}
        />
      </button>
      {listingAdd ? (
        <ChowkAddControl
          accent={accent}
          ink={ink}
          outOfStock={outOfStock}
          inCart={inCart}
          hasVariants={product.has_variants}
          canInc={!!cartItem && cartItem.quantity < cartItem.maxStock}
          onAdd={handleAdd}
          onInc={handleIncrement}
          onDec={handleDecrement}
        />
      ) : null}
    </div>
  );

  const meta = (
    <div className={layout === 'featured' ? 'flex flex-col justify-center px-5 py-6 md:px-10' : 'px-2.5 pb-3 pt-2'}>
      {layout === 'featured' ? (
        <>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: accent }}>
            Popular
          </p>
          <Link href={`/products/${product.id}`}>
            <h3 className="chowk-name line-clamp-2 text-[17px] font-medium leading-snug sm:text-xl" style={{ color: ink }}>
              {product.name}
            </h3>
          </Link>
          {excerpt ? (
            <p className="mt-2 max-w-sm text-[13px] leading-relaxed" style={{ color: ink, opacity: 0.55 }}>
              {excerpt}
              {product.description && product.description.trim().length > 140 ? '…' : ''}
            </p>
          ) : null}
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-[16px] font-semibold tabular-nums" style={{ color: ink }}>
              ₹{product.selling_price.toLocaleString('en-IN')}
            </span>
            {discount > 0 && product.mrp != null ? (
              <span className="text-[11px] tabular-nums line-through" style={{ color: ink, opacity: 0.38 }}>
                ₹{Number(product.mrp).toLocaleString('en-IN')}
              </span>
            ) : null}
          </p>
        </>
      ) : (
        <div className="flex items-start justify-between gap-1.5">
          <Link href={`/products/${product.id}`} className="min-w-0 flex-1">
            <h3 className="chowk-name line-clamp-2 text-[11px] font-medium leading-tight" style={{ color: ink }}>
              {product.name}
            </h3>
          </Link>
          <div className="shrink-0 text-right">
            <p className="text-[13px] font-semibold tabular-nums" style={{ color: ink }}>
              ₹{product.selling_price.toLocaleString('en-IN')}
            </p>
            {discount > 0 && product.mrp != null ? (
              <p className="text-[10px] tabular-nums line-through" style={{ color: ink, opacity: 0.4 }}>
                ₹{Number(product.mrp).toLocaleString('en-IN')}
              </p>
            ) : null}
          </div>
        </div>
      )}
      {(product.rating_count ?? 0) > 0 ? (
        <div className="mt-1">
          <StoreStars value={product.rating_avg ?? 0} count={product.rating_count} />
        </div>
      ) : null}
      {!khatario && product.unit ? (
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
        'group overflow-hidden rounded-2xl bg-white shadow-sm',
        layout === 'shelf' && 'w-[42vw] max-w-[12.5rem] flex-shrink-0 snap-start sm:w-44',
      )}
    >
      {imageBlock}
      {meta}
    </article>
  );
}
