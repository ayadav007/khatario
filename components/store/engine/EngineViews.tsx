'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import type { StoreCategoryStyle } from '@/lib/store/store-theme';
import type { StudioSettings } from '@/lib/store/studio-sections';
import type { StoreItem } from '@/lib/store/map-store-product';
import { useStore } from '@/lib/store/store-context';
import { useIsPhone } from '@/lib/store/phone-kit';
import { pickSlidesForDevice } from '@/lib/store/engine/shared';
import { catalogHref, ctaTarget, engineCatalogHref, engineProductHref } from '@/lib/store/engine/links';
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
      else if (t.kind === 'internal') router.push(t.href);
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
  const out: StudioSettings = { ...s, ...first };
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

function HeaderSearchBox({ subdomain, placeholder }: { subdomain: string; placeholder: string }) {
  const params = useSearchParams();
  const go = useCatalogNav();
  return (
    <div className="search" role="search">
      <Search aria-hidden="true" />
      <HeaderSearch
        subdomain={subdomain}
        value={params.get('q') ?? ''}
        onSubmit={(q) => go({ q: q.trim() || null })}
        onPick={(p: SearchPick) => go({ categoryId: p.id })}
        placeholder={placeholder}
        inputId="store-search"
        className="h-full min-w-0 flex-1 [&_input]:!min-h-0 [&_input]:!shadow-none [&_input]:!ring-0"
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
  nav,
  subdomain,
  searchPlaceholder,
  chips,
}: {
  s: StudioSettings;
  logoUrl: string | null;
  nav: StudioLink[];
  subdomain: string;
  searchPlaceholder: string;
  /** Category chips under the header row (All, then each category). */
  chips?: Chip[];
}) {
  const { cartCount } = useStore();
  const { openCart } = useEngineCart();
  const fallback = (
    <div className="search">
      <Search aria-hidden="true" />
      <span>{searchPlaceholder}</span>
    </div>
  );
  const header = (
    <StudioHeader
      s={s}
      logoUrl={logoUrl}
      nav={nav}
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
  ...props
}: {
  sectionId: string;
  s: StudioSettings;
  categories: StudioTileCategory[];
  style: StoreCategoryStyle;
  images: Record<string, string>;
  /** Category id to the text in its tile mark (emoji tiles). */
  marks?: Record<string, string>;
}) {
  return (
    <div id={categoriesAnchor(sectionId)} data-eng-anchor={ANCHOR_KIND.categories}>
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
}: {
  sectionId: string;
  s: StudioSettings;
  products: StoreItem[];
  /** Product rail: a carousel the phone kit turns into a swipe row. */
  isRow: boolean;
  /** Category shelves can hide the "View All" link. */
  showViewAll?: boolean;
}) {
  const router = useRouter();
  const go = useCatalogNav();
  const source = s.source ?? 'all';
  const settings: StudioSettings = { ...s, display: isRow ? 'carousel' : 'grid' };
  const gridClass = isRow ? 'isRow' : undefined;

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
