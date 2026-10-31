'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, MapPin, Search, ShoppingCart, User } from 'lucide-react';
import type { StoreCategoryStyle } from '@/lib/store/store-theme';
import type { StudioSettings } from '@/lib/store/studio-sections';
import type { StoreItem } from '@/lib/store/map-store-product';
import { useStore } from '@/lib/store/store-context';
import { useIsPhone } from '@/lib/store/phone-kit';
import { pickSlidesForDevice } from '@/lib/store/engine/shared';
import { catalogHref, ctaTarget, engineCatalogHref, engineProductHref, withPreviewParams } from '@/lib/store/engine/links';
import { ANCHOR_KIND, catalogAnchor, categoriesAnchor, findAnchor, firstCatalogAnchorId } from '@/lib/store/engine/anchors';
import { StoreProductCard, type StoreProduct } from '../StoreProductCard';
import { HeaderSearch, type SearchPick } from '../features/catalog/HeaderSearch';
import {
  StudioBanner,
  StudioCategoriesSection,
  StudioHeader,
  StudioHero,
  StudioProductsSection,
  heroSlides,
  type StudioLink,
  type StudioTileCategory,
} from '../studio-theme/StudioSections';
import { useEngineCart } from './EngineShell';
import { MenuBar } from './menu/MenuBar';
import { useEngineCardLook } from './EngineCardContext';
import { QuickSheet } from '../quick-theme/QuickChrome';
import { activeQuickCategory, quickChips, quickDeliveryLine, quickSearchHints } from '@/lib/store/engine/quick-header';
import type { ResolvedItem } from '@/lib/store/engine/menus';
import { cleanPincode, pincodeLine, pincodeServiceable, storePinKey } from '@/lib/store/store-pincode';

/**
 * Preset links and CTA defaults use `#catalog`; each `source: 'all'` grid carries its own
 * `catalog-<section id>` anchor and `#catalog` scrolls to the first one (D12).
 */
const CATALOG_LINK = '#catalog';

function scrollToId(id: string) {
  findAnchor(document, id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Follows a CTA link: `#anchor` scrolls, internal paths use the router, https opens in this tab. */
export function useFollowLink() {
  const router = useRouter();
  return useCallback(
    (link: string) => {
      const t = ctaTarget(link);
      if (t.kind === 'anchor') scrollToId(t.id);
      else if (t.kind === 'internal') router.push(withPreviewParams(window.location.search, t.href));
      else if (t.kind === 'external') window.location.assign(t.href);
    },
    [router],
  );
}

/**
 * Opens the catalog page (D14) for a category and/or search, keeping preview params. A store whose
 * catalog template is empty sends it on to the home page's narrowed grid.
 */
function useCatalogNav() {
  const router = useRouter();
  return useCallback(
    (next: { categoryId?: string | null; q?: string | null }) =>
      router.push(engineCatalogHref(window.location.search, next)),
    [router],
  );
}

/**
 * The slides for this device (D28): those set to it or to both, else all. The server and the first
 * client render use desktop, as the old storefront did; phones switch after mount.
 */
function slidesForDevice(s: StudioSettings, devices: string[] | undefined, phone: boolean): StudioSettings {
  if (!devices || devices.length === 0) return s;
  const all = heroSlides(s);
  const picked = pickSlidesForDevice(devices.slice(0, all.length), phone).filter((i) => i < all.length);
  if (picked.length === 0 || picked.length === all.length) return s;
  const [first, ...rest] = picked.map((i) => all[i]);
  // Slide one's phone image belongs to slide one, not to whichever slide now leads.
  const out: StudioSettings = { ...s, mobileImage: undefined, ...first };
  if (rest.length) out.slides = rest;
  else delete out.slides;
  return out;
}

export function EngineHero({ s, devices }: { s: StudioSettings; devices?: Array<'both' | 'mobile' | 'desktop'> }) {
  const follow = useFollowLink();
  const phone = useIsPhone();
  const shown = slidesForDevice(s, devices, phone);
  return (
    <StudioHero
      key={phone ? 'mobile' : 'desktop'}
      s={shown}
      live
      onCta={(link) => follow(link || CATALOG_LINK)}
    />
  );
}

export interface EnginePromoCard {
  id: string;
  eyebrow: string;
  heading: string;
  text: string;
  buttonText: string;
  link: string;
  image: string;
}

/** Promo cards: `split` puts the copy beside the image, `overlay` puts a caption over it. */
export function EnginePromoCards({
  heading,
  style,
  columns,
  cards,
}: {
  heading: string;
  style: 'split' | 'overlay';
  columns: number;
  cards: EnginePromoCard[];
}) {
  const follow = useFollowLink();
  return (
    <div className="eng-promos-block">
      {heading ? <h2>{heading}</h2> : null}
      <div className="eng-promos" data-style={style} style={{ ['--eng-cols' as string]: String(columns) }}>
        {cards.map((c) => (
          <article key={c.id} className={`eng-promo ${c.image ? 'has-img' : 'no-img'}`}>
            {c.image ? (
              <div className="eng-promo-img" style={{ backgroundImage: `url(${JSON.stringify(c.image)})` }} />
            ) : null}
            <div className="eng-promo-copy">
              {c.eyebrow ? <small className="eyebrow">{c.eyebrow}</small> : null}
              {c.heading ? <h3>{c.heading}</h3> : null}
              {c.text ? <p>{c.text}</p> : null}
              {c.buttonText ? (
                <button type="button" className="st-btn" onClick={() => follow(c.link || CATALOG_LINK)}>
                  {c.buttonText} →
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/** Scrolling announcement: the items run in a CSS loop (paused under reduced motion); the whole bar follows the link. */
export function EngineAnnouncementScroll({ items, link }: { items: string[]; link: string }) {
  const follow = useFollowLink();
  const run = (hidden: boolean) => (
    <div className="eng-announce-run" aria-hidden={hidden || undefined}>
      {items.map((t, i) => (
        <span key={i}>{t}</span>
      ))}
    </div>
  );
  const inner = (
    <div className="eng-announce-scroll">
      <div className="eng-announce-track">
        {run(false)}
        {run(true)}
      </div>
    </div>
  );
  if (!link) return <div className="announce eng-announce">{inner}</div>;
  return (
    <a
      className="announce eng-announce"
      href={link}
      onClick={(e) => {
        e.preventDefault();
        follow(link);
      }}
    >
      {inner}
    </a>
  );
}

export function EngineBanner({ s }: { s: StudioSettings }) {
  const follow = useFollowLink();
  return <StudioBanner s={s} onCta={() => follow(s.link || CATALOG_LINK)} />;
}

/** Studio's `.st-btn` that follows a link. */
export function EngineCtaButton({ label, link }: { label: string; link: string }) {
  const follow = useFollowLink();
  return (
    <button type="button" className="st-btn" onClick={() => follow(link || CATALOG_LINK)}>
      {label} →
    </button>
  );
}

function HeaderSearchBox({
  subdomain,
  placeholder,
  className = 'search',
}: {
  subdomain: string;
  placeholder: string;
  className?: string;
}) {
  const params = useSearchParams();
  const go = useCatalogNav();
  return (
    <div className={className} role="search">
      <Search aria-hidden="true" />
      <HeaderSearch
        subdomain={subdomain}
        value={params.get('q') ?? ''}
        onSubmit={(q) => go({ q: q.trim() || null })}
        onPick={(p: SearchPick) => go({ categoryId: p.id })}
        placeholder={placeholder}
        inputId="store-search"
        // Quick's box sizes the input itself (quick-theme.css); the Studio header needs it shrunk to its row.
        className={
          className === 'qk-search'
            ? 'h-full min-w-0 flex-1 [&_input]:!shadow-none'
            : 'h-full min-w-0 flex-1 [&_input]:!min-h-0 [&_input]:!shadow-none [&_input]:!ring-0'
        }
      />
    </div>
  );
}

type Chip = { id: string; name: string };

function ChipRow({ chips, selectedId, onPick }: { chips: Chip[]; selectedId: string | null; onPick?: (id: string | null) => void }) {
  return (
    <nav className="eng-chips" aria-label="Categories">
      <button type="button" className={selectedId ? '' : 'on'} aria-pressed={!selectedId} onClick={() => onPick?.(null)}>
        All
      </button>
      {chips.map((c) => (
        <button
          type="button"
          key={c.id}
          className={selectedId === c.id ? 'on' : ''}
          aria-pressed={selectedId === c.id}
          onClick={() => onPick?.(c.id)}
        >
          {c.name}
        </button>
      ))}
    </nav>
  );
}

function CategoryChips({ chips }: { chips: Chip[] }) {
  const params = useSearchParams();
  const go = useCatalogNav();
  return <ChipRow chips={chips} selectedId={params.get('cat')} onPick={(id) => go({ categoryId: id })} />;
}

export function EngineHeader({
  s,
  logoUrl,
  menu,
  subdomain,
  searchPlaceholder,
  chips,
  quick,
}: {
  s: StudioSettings;
  logoUrl: string | null;
  /** The header's resolved menu, its layout and whether top items are in capitals. */
  menu: { items: ResolvedItem[]; layout: 'below' | 'inline'; caps: boolean };
  subdomain: string;
  searchPlaceholder: string;
  /** Category chips under the header row (All, then each category). */
  chips?: Chip[];
  /** Quick preset only: the old Quick header (delivery line, pincode, cycling hint, pill row). */
  quick?: QuickHeaderProps;
}) {
  const { cartCount } = useStore();
  const { openCart } = useEngineCart();
  const look = useEngineCardLook();
  if (look?.quick && quick) {
    return <EngineQuickHeader {...quick} logoUrl={logoUrl} subdomain={subdomain} placeholder={searchPlaceholder} />;
  }
  const fallback = (
    <div className="search">
      <Search aria-hidden="true" />
      <span>{searchPlaceholder}</span>
    </div>
  );
  const bar = menu.items.length ? <MenuBar items={menu.items} layout={menu.layout} caps={menu.caps} /> : null;
  const header = (
    <StudioHeader
      s={s}
      logoUrl={logoUrl}
      menuSlot={menu.layout === 'below' ? bar : null}
      inlineSlot={menu.layout === 'inline' ? bar : undefined}
      search={
        <Suspense fallback={fallback}>
          <HeaderSearchBox subdomain={subdomain} placeholder={searchPlaceholder} />
        </Suspense>
      }
      cartCount={cartCount}
      onCart={openCart}
      accountHref="/account"
      homeHref="/"
    />
  );
  if (!chips || chips.length === 0) return header;
  return (
    <>
      {header}
      <Suspense fallback={<ChipRow chips={chips} selectedId={null} />}>
        <CategoryChips chips={chips} />
      </Suspense>
    </>
  );
}

function CategoryTiles({
  s,
  categories,
  style,
  images,
  marks,
}: {
  s: StudioSettings;
  categories: StudioTileCategory[];
  style: StoreCategoryStyle;
  images: Record<string, string>;
  marks?: Record<string, string>;
}) {
  const params = useSearchParams();
  const go = useCatalogNav();
  return (
    <StudioCategoriesSection
      s={s}
      categories={categories}
      style={style}
      images={images}
      marks={marks}
      selectedId={params.get('cat')}
      onSelect={(id) => go({ categoryId: id })}
      viewAll={{ label: 'View All', onClick: () => go({}) }}
    />
  );
}

export function EngineCategoryGrid({
  sectionId,
  className,
  ...props
}: {
  sectionId: string;
  /** The circles / cards look (`categoryGridClass`). */
  className?: string;
  s: StudioSettings;
  categories: StudioTileCategory[];
  style: StoreCategoryStyle;
  images: Record<string, string>;
  /** Category id to the text in its tile mark (emoji tiles). */
  marks?: Record<string, string>;
}) {
  return (
    <div id={categoriesAnchor(sectionId)} data-eng-anchor={ANCHOR_KIND.categories} className={className}>
      <Suspense fallback={null}>
        <CategoryTiles {...props} />
      </Suspense>
    </div>
  );
}

/** Collection list tiles: real category links, followed through the router so preview params stay. */
export function EngineCollectionList({
  heading,
  columns,
  tiles,
}: {
  heading: string;
  columns: number;
  tiles: { categoryId: string; title: string; image: string }[];
}) {
  const go = useCatalogNav();
  return (
    <div className="eng-collections">
      {heading ? <h2>{heading}</h2> : null}
      <div className="eng-collections-grid" style={{ ['--eng-cols' as string]: String(columns) }}>
        {tiles.map((t) => (
          <a
            key={t.categoryId}
            className="eng-collection"
            href={engineCatalogHref('', { categoryId: t.categoryId })}
            onClick={(e) => {
              e.preventDefault();
              go({ categoryId: t.categoryId });
            }}
          >
            <span className="eng-collection-img" style={t.image ? { backgroundImage: `url(${JSON.stringify(t.image)})` } : undefined} />
            <span className="eng-collection-title">{t.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** How many top sellers get the "Bestseller" badge (as StudioSourcedProducts). */
const BESTSELLER_BADGES = 3;

/** "Showing <category or “q”> · Clear" when the URL narrows the all-products grid. */
function useNarrowing(products: StoreItem[]) {
  const params = useSearchParams();
  const cat = params.get('cat');
  const q = params.get('q');
  if (!cat && !q) return null;
  const catName = cat ? products.find((p) => p.category_id === cat)?.category_name : null;
  const label = q ? `“${q}”` : catName || 'one category';
  return { label };
}

function NarrowableGrid({
  sectionId,
  s,
  products,
  className,
}: {
  sectionId: string;
  s: StudioSettings;
  products: StoreItem[];
  className?: string;
}) {
  const narrowing = useNarrowing(products);
  const router = useRouter();
  // Clearing returns to the home page's full grid.
  const clear = () => router.push(catalogHref(window.location.search, {}, firstCatalogAnchorId(document)));
  if (products.length === 0 && !narrowing) return null;
  return (
    <StudioProductsSection
      id={catalogAnchor(sectionId)}
      anchorKind={ANCHOR_KIND.catalog}
      s={s}
      action={null}
      gridClassName={className}
      chips={
        narrowing ? (
          <div className="st-chips">
            <button type="button" className="on" onClick={clear} aria-label={`Showing ${narrowing.label}. Clear`}>
              Showing {narrowing.label} · Clear
            </button>
          </div>
        ) : null
      }
    >
      {products.map((item) => (
        <StoreProductCard
          key={item.id}
          product={item as StoreProduct}
          onViewDetail={(p) => router.push(engineProductHref(window.location.search, p.id))}
        />
      ))}
      {products.length === 0 ? <div className="empty">No products found.</div> : null}
    </StudioProductsSection>
  );
}

export function EngineProductGrid({
  sectionId,
  s,
  products,
  isRow,
  showViewAll = true,
  gridClass: extraClass,
}: {
  sectionId: string;
  s: StudioSettings;
  products: StoreItem[];
  /** Product rail: a carousel the phone kit turns into a swipe row. */
  isRow: boolean;
  /** Extra grid classes, e.g. `mcols-3` for the section's phone columns. */
  gridClass?: string;
  /** Category shelves can hide the "View All" link. */
  showViewAll?: boolean;
}) {
  const router = useRouter();
  const go = useCatalogNav();
  const source = s.source ?? 'all';
  const settings: StudioSettings = { ...s, display: isRow ? 'carousel' : 'grid' };
  const gridClass = [isRow ? 'isRow' : '', extraClass ?? ''].filter(Boolean).join(' ') || undefined;

  if (source === 'all' && !isRow) {
    return (
      <Suspense fallback={null}>
        <NarrowableGrid sectionId={sectionId} s={settings} products={products} className={gridClass} />
      </Suspense>
    );
  }
  if (products.length === 0) return null;

  const action: StudioLink | null = !showViewAll ? null : {
    label: 'View All',
    onClick: () => {
      if (source === 'category' && s.categoryId) go({ categoryId: s.categoryId });
      // An all-products grid on this page if there is one, else the catalog page.
      else if (findAnchor(document, 'catalog')) scrollToId('catalog');
      else go({});
    },
  };
  return (
    <StudioProductsSection s={settings} action={action} gridClassName={gridClass}>
      {products.map((item, i) => (
        <StoreProductCard
          key={item.id}
          product={item as StoreProduct}
          onViewDetail={(p) => router.push(engineProductHref(window.location.search, p.id))}
          highlight={source === 'bestsellers' && i < BESTSELLER_BADGES && (item.sold_count ?? 0) > 0 ? 'Bestseller' : undefined}
        />
      ))}
    </StudioProductsSection>
  );
}

export interface QuickHeaderProps {
  name: string;
  /** The header's delivery estimate, e.g. "in 30 minutes". */
  eta: string;
  links: Array<{ label: string; href: string; highlight: boolean }>;
  categories: Chip[];
  showSearch: boolean;
  showAccount: boolean;
  showCart: boolean;
}

/** Cycles through `hints` every 2.6 s (not with reduced motion). */
function useCyclingHint(hints: string[]): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (hints.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI((n) => n + 1), 2600);
    return () => window.clearInterval(t);
  }, [hints.length]);
  return hints[i % hints.length] ?? '';
}

/**
 * The Quick preset's header, the old Quick store's markup (quick-theme.css): delivery line with the pincode sheet,
 * account and cart, a search box with cycling category hints, and a pill row ending in a highlighted Offers.
 */
function EngineQuickHeader({
  name,
  eta,
  links,
  categories,
  showSearch,
  showAccount,
  showCart,
  logoUrl,
  subdomain,
  placeholder,
}: QuickHeaderProps & { logoUrl: string | null; subdomain: string; placeholder: string }) {
  const { cartCount, branches, selectedBranchId, selectBranch, store } = useStore();
  const { openCart } = useEngineCart();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pincode, setPincode] = useState('');
  const hint = useCyclingHint(quickSearchHints(placeholder, categories));
  useEffect(() => {
    try {
      setPincode(cleanPincode(localStorage.getItem(storePinKey(subdomain)) ?? ''));
    } catch {
      /* storage blocked */
    }
  }, [subdomain]);
  const savePin = (value: string) => {
    const next = cleanPincode(value);
    setPincode(next);
    try {
      localStorage.setItem(storePinKey(subdomain), next);
    } catch {
      /* storage blocked */
    }
  };
  const branch = branches.find((b) => b.id === selectedBranchId) ?? (branches.length === 1 ? branches[0] : undefined);
  const pinOk = pincodeServiceable(branch, pincode);
  const chips = quickChips(links, categories);

  return (
    <div className="qk-top">
      <div className="qk-head">
        <div className="qk-row">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="qk-logo" src={logoUrl} alt={name} />
          ) : null}
          <button type="button" className="qk-loc" onClick={() => setSheetOpen(true)} aria-label="Change delivery location">
            <b>{quickDeliveryLine(eta, name)}</b>
            <span>
              <MapPin aria-hidden="true" />
              {pincodeLine(pincode, branch?.name, store?.name ?? name)}
              <ChevronDown aria-hidden="true" />
            </span>
          </button>
          <div className="qk-actions">
            {showAccount ? (
              <Link href="/account" aria-label="Account">
                <User />
              </Link>
            ) : null}
            {showCart ? (
              <button
                type="button"
                className="qk-cartBtn"
                onClick={openCart}
                aria-label={cartCount ? `Cart, ${cartCount} items` : 'Cart'}
              >
                <ShoppingCart />
                {cartCount > 0 ? <sup>{cartCount}</sup> : null}
              </button>
            ) : null}
          </div>
        </div>
        {showSearch ? (
          <Suspense
            fallback={
              <div className="qk-search">
                <Search aria-hidden="true" />
                <span>{hint}</span>
              </div>
            }
          >
            <HeaderSearchBox subdomain={subdomain} placeholder={hint} className="qk-search" />
          </Suspense>
        ) : null}
        {chips.length ? (
          <Suspense fallback={<QuickPills chips={chips} />}>
            <QuickPillsLive chips={chips} />
          </Suspense>
        ) : null}
      </div>
      <QuickSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        label="Delivery location"
        title={<h2>Where should we deliver?</h2>}
        footer={
          <button type="button" className="qk-cta qk-ctaPlain" onClick={() => setSheetOpen(false)}>
            Done
          </button>
        }
      >
        <div className="qk-locBody">
          {branches.length > 1 ? (
            <div className="qk-branches">
              {branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={b.id === selectedBranchId ? 'on' : ''}
                  onClick={() => selectBranch(b.id)}
                >
                  <MapPin />
                  {b.name}
                </button>
              ))}
            </div>
          ) : null}
          <label>
            Pincode
            <input
              inputMode="numeric"
              value={pincode}
              onChange={(e) => savePin(e.target.value)}
              placeholder="6-digit pincode"
              autoFocus
            />
          </label>
          {pincode.length === 6 && !pinOk ? (
            <p className="warn">This store may not deliver to {pincode}. Pickup may still be available.</p>
          ) : pincode.length === 6 ? (
            <p className="good">We deliver to {pincode}.</p>
          ) : null}
        </div>
      </QuickSheet>
    </div>
  );
}

type QuickPill = ReturnType<typeof quickChips>[number];

function QuickPills({
  chips,
  activeCat,
  offersOn,
  onCategory,
}: {
  chips: QuickPill[];
  activeCat?: string | null;
  offersOn?: boolean;
  onCategory?: (id: string) => void;
}) {
  return (
    <nav className="qk-chips" aria-label="Shop">
      {chips.map((c) => {
        const on = c.categoryId ? c.categoryId === activeCat : c.offers && !!offersOn;
        const cls = [on ? 'on' : '', c.offers ? 'offers' : ''].join(' ').trim() || undefined;
        const id = c.categoryId;
        return id ? (
          <button type="button" key={c.key} className={cls} aria-pressed={on} onClick={() => onCategory?.(id)}>
            {c.label}
          </button>
        ) : (
          <a key={c.key} className={cls} href={c.href}>
            {c.label}
          </a>
        );
      })}
    </nav>
  );
}

function QuickPillsLive({ chips }: { chips: QuickPill[] }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const go = useCatalogNav();
  return (
    <QuickPills
      chips={chips}
      activeCat={activeQuickCategory(pathname, params.get('cat'))}
      offersOn={!!params.get('disc')}
      onCategory={(id) => go({ categoryId: id })}
    />
  );
}
