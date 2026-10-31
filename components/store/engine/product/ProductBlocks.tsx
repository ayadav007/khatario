'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Heart, Minus, Plus, Share2, Truck } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { StoreStars } from '@/components/store/StoreStars';
import { ProductGallery, ProductInfoTabs, VariantPicker } from '@/components/store/features/product';
import { shareUrl } from '@/lib/store/engine/links';
import { useEngineProduct } from './EngineProductContext';
import { buyButtonState, type ProductBlockProps } from './product-blocks';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

// Buttons follow the section's colour scheme (button / button text), else the store's primary colour.
const BTN: CSSProperties = {
  background: 'var(--c-btn, var(--primary))',
  color: 'var(--c-btn-text, var(--on-primary, #fff))',
  borderRadius: 'var(--btn-radius, 10px)',
};
const OUTLINE: CSSProperties = {
  borderColor: 'color-mix(in srgb, currentColor 20%, transparent)',
  borderRadius: 'var(--btn-radius, 10px)',
};

const on = (v: unknown) => v !== false;
const text = (v: unknown) => (typeof v === 'string' ? v : '');

function TitleBlock({ id, settings }: ProductBlockProps) {
  const { product, rating, setRated } = useEngineProduct();
  const { customer, rateProduct } = useStore();
  if (!product) return null;
  const meta = [product.category_name, product.unit].filter(Boolean).join(' · ');
  return (
    <div data-eng-block={id}>
      {on(settings.show_brand) && product.brand ? (
        <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{product.brand}</p>
      ) : null}
      <h1 className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">{product.name}</h1>
      {on(settings.show_meta) && meta ? <p className="mt-1 text-sm opacity-60">{meta}</p> : null}
      {on(settings.show_rating) ? (
        <div className="mt-2">
          <StoreStars
            value={rating.avg}
            count={rating.count}
            size="md"
            onRate={
              customer
                ? (n) => {
                    void rateProduct(product.id, n).then((next) => {
                      if (next) setRated(next.rating_avg, next.rating_count);
                    });
                  }
                : undefined
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function PriceBlock({ id, settings }: ProductBlockProps) {
  const { product, offer } = useEngineProduct();
  if (!product || !offer) return null;
  return (
    <div data-eng-block={id}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-3xl font-bold tabular-nums">{inr(offer.price)}</span>
        {offer.mrp ? (
          <>
            <span className="text-sm tabular-nums line-through opacity-50">
              <span className="sr-only">MRP </span>
              {inr(offer.mrp)}
            </span>
            <span className="text-sm font-semibold" style={{ color: 'var(--c-accent, var(--primary))' }}>
              {offer.percentOff}% off
            </span>
          </>
        ) : null}
      </p>
      {on(settings.show_tax_note) && product.tax_rate > 0 ? (
        <p className="mt-1 text-xs opacity-60">
          GST {product.tax_rate}%{product.gst_included ? ' included' : ' extra'}
        </p>
      ) : null}
    </div>
  );
}

function VariantBlock({ id }: ProductBlockProps) {
  const { needsVariant, variants, variantId, setVariantId } = useEngineProduct();
  if (!needsVariant) return null;
  return (
    <div data-eng-block={id}>
      <VariantPicker variants={variants} value={variantId} onChange={setVariantId} />
    </div>
  );
}

function BuyButtonsBlock({ id, settings }: ProductBlockProps) {
  const { product, offer, needsVariant, variant, cartItem, add, setQuantity } = useEngineProduct();
  const { favoriteIds, toggleFavorite } = useStore();
  if (!product || !offer) return null;
  const quantity = cartItem?.quantity ?? 0;
  const state = buyButtonState({
    canAdd: offer.canAdd,
    stock: offer.stock,
    needsVariant,
    variantChosen: variant != null,
    inCart: !!cartItem,
    quantity,
  });
  const favorite = favoriteIds.includes(product.id);
  return (
    <div data-eng-block={id} className="flex items-stretch gap-3">
      {state === 'stepper' ? (
        <div className="inline-flex min-h-12 items-center" style={BTN}>
          <button
            type="button"
            className="flex h-12 w-12 items-center justify-center"
            aria-label="Decrease quantity"
            onClick={() => setQuantity(quantity - 1)}
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
            onClick={() => setQuantity(quantity + 1)}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={state !== 'add'}
          onClick={add}
          className={
            state === 'add'
              ? 'min-h-12 flex-1 px-6 text-sm font-semibold sm:flex-none sm:px-10'
              : 'min-h-12 flex-1 cursor-not-allowed bg-gray-200 px-6 text-sm font-semibold text-gray-500 sm:flex-none sm:px-10'
          }
          style={state === 'add' ? BTN : { borderRadius: BTN.borderRadius }}
        >
          {state === 'sold_out' ? 'Out of stock' : state === 'add' ? 'Add to cart' : 'Choose an option'}
        </button>
      )}
      {on(settings.show_wishlist) ? (
        <button
          type="button"
          aria-pressed={favorite}
          aria-label={favorite ? 'Remove from wishlist' : 'Save to wishlist'}
          onClick={() => void toggleFavorite(product.id)}
          className="flex h-12 w-12 shrink-0 items-center justify-center border"
          style={OUTLINE}
        >
          <Heart
            className={favorite ? 'h-5 w-5' : 'h-5 w-5 opacity-60'}
            style={favorite ? { fill: 'var(--c-btn, var(--primary))', color: 'var(--c-btn, var(--primary))' } : undefined}
          />
        </button>
      ) : null}
    </div>
  );
}

function DescriptionBlock({ id }: ProductBlockProps) {
  const { product } = useEngineProduct();
  if (!product) return null;
  return (
    <div data-eng-block={id}>
      <ProductInfoTabs
        description={product.description}
        tabs={product.store_tabs ?? []}
        sizeChart={product.size_chart ?? null}
      />
    </div>
  );
}

/** Heading plus the merchant's rich text, sanitised on the server. */
function CollapsibleTabBlock({ id, settings }: ProductBlockProps) {
  const heading = text(settings.heading);
  const html = text(settings.content);
  if (!heading && !html) return null;
  return (
    <details data-eng-block={id} className="border-y py-1" style={{ borderColor: 'color-mix(in srgb, currentColor 15%, transparent)' }}>
      <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold">{heading || 'Details'}</summary>
      {html ? <div className="eng-rt pb-3 text-sm" dangerouslySetInnerHTML={{ __html: html }} /> : null}
    </details>
  );
}

function DeliveryBlock({ id, settings }: ProductBlockProps) {
  const label = text(settings.text);
  if (!label) return null;
  return (
    <p data-eng-block={id} className="flex items-center gap-2 text-sm">
      <Truck className="h-4 w-4 opacity-60" aria-hidden />
      {label}
    </p>
  );
}

function ShareBlock({ id, settings }: ProductBlockProps) {
  const { product } = useEngineProduct();
  const [copied, setCopied] = useState(false);
  // Hidden when the page URL cannot give a shareable link (checked after mount: window is client-only).
  const [shareable, setShareable] = useState(true);
  useEffect(() => setShareable(shareUrl(window.location.href) !== ''), []);
  if (!product || !shareable) return null;
  const share = async () => {
    // Never the page URL as is: a preview link's token must not travel with the shared product.
    const url = shareUrl(window.location.href);
    if (!url) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the shopper closed the share sheet */
    }
  };
  return (
    <div data-eng-block={id}>
      <button type="button" onClick={() => void share()} className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium">
        <Share2 className="h-4 w-4 opacity-60" aria-hidden />
        {copied ? 'Link copied' : text(settings.label) || 'Share'}
      </button>
    </div>
  );
}

/** The merchant's rich text, sanitised on the server. */
function CustomTextBlock({ id, settings }: ProductBlockProps) {
  const html = text(settings.text);
  if (!html) return null;
  return <div data-eng-block={id} className="eng-rt text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}

const BLOCKS: Record<string, (p: ProductBlockProps) => JSX.Element | null> = {
  title: TitleBlock,
  price: PriceBlock,
  variant_picker: VariantBlock,
  buy_buttons: BuyButtonsBlock,
  description: DescriptionBlock,
  collapsible_tab: CollapsibleTabBlock,
  delivery_estimate: DeliveryBlock,
  share: ShareBlock,
  custom_text: CustomTextBlock,
};

/** `main-product`: the gallery beside the info column, whose blocks render in the merchant's order. */
export function EngineMainProduct({
  blocks,
  galleryPosition,
  thumbs,
  stickyInfo,
}: {
  blocks: ProductBlockProps[];
  galleryPosition: 'left' | 'right';
  thumbs: 'side' | 'bottom';
  stickyInfo: boolean;
}) {
  const { product } = useEngineProduct();
  if (!product) return null;
  const images = product.images?.length ? product.images : product.image_url ? [product.image_url] : [];
  const right = galleryPosition === 'right';
  return (
    <div
      className={`grid gap-6 px-4 sm:px-8 md:items-start md:gap-10 ${right ? 'md:grid-cols-[45fr_55fr]' : 'md:grid-cols-[55fr_45fr]'}`}
    >
      <div className={right ? 'min-w-0 md:order-2' : 'min-w-0'}>
        <ProductGallery images={images} videoUrl={product.video_url} alt={product.name} thumbs={thumbs} />
      </div>
      <div className={`min-w-0 space-y-5 ${right ? 'md:order-1' : ''} ${stickyInfo ? 'md:sticky md:top-24' : ''}`}>
        {blocks.map((b) => {
          const Block = Object.prototype.hasOwnProperty.call(BLOCKS, b.type) ? BLOCKS[b.type] : null;
          return Block ? <Block key={b.id} {...b} /> : null;
        })}
      </div>
    </div>
  );
}
