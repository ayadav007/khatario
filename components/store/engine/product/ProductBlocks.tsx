'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Heart, Share2, Truck } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { StoreStars } from '@/components/store/StoreStars';
import { ProductGallery, ProductInfoTabs, VariantPicker } from '@/components/store/features/product';
import { shareUrl } from '@/lib/store/engine/links';
import { cleanPincode, deliveryCheckAnswer, deliveryCheckShown, pincodeToSave, storePinKey } from '@/lib/store/store-pincode';
import { useEngineProduct } from './EngineProductContext';
import { BTN, BuyStepper, inr, useBuyState } from './buy-action';
import { lowStockNote, youSave, type ProductBlockProps } from './product-blocks';
import { StickyBuyBar } from './StickyBuyBar';

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
      {settings.show_tagline === true && product.store_tagline ? (
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide opacity-60">{product.store_tagline}</p>
      ) : null}
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
  const saved = youSave(offer.price, Number(product.selling_price) || 0, offer.mrp);
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
      {saved != null ? (
        <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--c-accent, var(--primary))' }}>
          You save {inr(saved)}
        </p>
      ) : null}
      {on(settings.show_tax_note) && product.tax_rate > 0 ? (
        <p className="mt-1 text-xs opacity-60">
          GST {product.tax_rate}%{product.gst_included ? ' included' : ' extra'}
        </p>
      ) : null}
      {product.returnable === false ? <p className="mt-1 text-xs opacity-60">This item can&apos;t be returned</p> : null}
    </div>
  );
}

function VariantBlock({ id, settings }: ProductBlockProps) {
  const { product, needsVariant, variants, variant, variantId, setVariantId } = useEngineProduct();
  const fitNote = product?.store_fit_note?.trim() || null;
  if (!needsVariant && !fitNote) return null;
  const threshold = Math.min(10, Math.max(0, Math.floor(Number(settings.low_stock_at) || 0)));
  const note = needsVariant ? lowStockNote(variant, threshold) : null;
  return (
    <div data-eng-block={id}>
      {needsVariant ? (
        <VariantPicker
          variants={variants}
          value={variantId}
          onChange={setVariantId}
          tiles={settings.style === 'tiles'}
          basePrice={Number(product?.selling_price) || 0}
        />
      ) : null}
      {note ? (
        <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--c-accent, var(--primary))' }} aria-live="polite">
          {note}
        </p>
      ) : null}
      {fitNote ? <p className="mt-2 text-sm opacity-70">{fitNote}</p> : null}
    </div>
  );
}

function BuyButtonsBlock({ id, settings }: ProductBlockProps) {
  const buy = useBuyState();
  const { favoriteIds, toggleFavorite } = useStore();
  if (!buy) return null;
  const { product, offer, state, quantity, add, setQuantity } = buy;
  const favorite = favoriteIds.includes(product.id);
  return (
    <div data-eng-block={id} className="flex items-stretch gap-3">
      {state === 'stepper' ? (
        <BuyStepper quantity={quantity} stock={offer.stock} onChange={setQuantity} />
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

/** "Check delivery": the shopper's pincode against the branch's list, shown only when the branch has its own list. */
function DeliveryCheckBlock({ id, settings }: ProductBlockProps) {
  const { store, branches, selectedBranchId } = useStore();
  const subdomain = store?.store_subdomain ?? '';
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState('');
  useEffect(() => {
    if (!subdomain) return;
    try {
      const saved = cleanPincode(localStorage.getItem(storePinKey(subdomain)) ?? '');
      setTyped(saved);
      setChecked(saved);
    } catch {
      /* storage blocked */
    }
  }, [subdomain]);
  const branch = branches.find((b) => b.id === selectedBranchId) ?? (branches.length === 1 ? branches[0] : undefined);
  if (!deliveryCheckShown(branch)) return null;
  const check = () => {
    const next = cleanPincode(typed);
    setTyped(next);
    setChecked(next);
    const toSave = pincodeToSave(next);
    if (!toSave) return;
    try {
      localStorage.setItem(storePinKey(subdomain), toSave);
    } catch {
      /* storage blocked */
    }
  };
  const heading = text(settings.heading);
  const answer = deliveryCheckAnswer(branch, checked);
  return (
    <div data-eng-block={id}>
      {heading ? (
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Truck className="h-4 w-4 opacity-60" aria-hidden />
          {heading}
        </p>
      ) : null}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          check();
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          value={typed}
          onChange={(e) => setTyped(cleanPincode(e.target.value))}
          placeholder="Pincode"
          aria-label={heading || 'Delivery pincode'}
          className="min-h-[44px] w-full min-w-0 flex-1 border bg-transparent px-3 text-sm"
          style={OUTLINE}
        />
        <button type="submit" className="min-h-[44px] shrink-0 px-5 text-sm font-semibold" style={BTN}>
          {text(settings.button_label) || 'Check'}
        </button>
      </form>
      <p aria-live="polite" className="mt-1 min-h-[1.25rem] text-sm">
        {answer}
      </p>
    </div>
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
  delivery_check: DeliveryCheckBlock,
  share: ShareBlock,
  custom_text: CustomTextBlock,
};

/** `main-product`: the gallery beside the info column, whose blocks render in the merchant's order. */
export function EngineMainProduct({
  blocks,
  galleryPosition,
  thumbs,
  stickyInfo,
  stickyBuyBar = false,
}: {
  blocks: ProductBlockProps[];
  galleryPosition: 'left' | 'right';
  thumbs: 'side' | 'bottom' | 'grid';
  stickyInfo: boolean;
  stickyBuyBar?: boolean;
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
      {stickyBuyBar ? (
        <StickyBuyBar
          buyBlockId={blocks.find((b) => b.type === 'buy_buttons')?.id ?? null}
          optionsBlockId={blocks.find((b) => b.type === 'variant_picker')?.id ?? null}
        />
      ) : null}
    </div>
  );
}
