'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import type { StoreCategoryStyle } from '@/lib/store/store-theme';
import type { StudioSettings } from '@/lib/store/studio-sections';
import type { StoreItem } from '@/lib/store/map-store-product';
import { useStore } from '@/lib/store/store-context';
import { catalogHref, ctaTarget, engineCatalogHref } from '@/lib/store/engine/links';
import { ANCHOR_KIND, catalogAnchor, categoriesAnchor, findAnchor, firstCatalogAnchorId } from '@/lib/store/engine/anchors';
import { StoreProductCard, type StoreProduct } from '../StoreProductCard';
import { HeaderSearch, type SearchPick } from '../features/catalog/HeaderSearch';
import {
  StudioBanner,
  StudioCategoriesSection,
  StudioHeader,
  StudioHero,
  StudioProductsSection,
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

export function EngineHero({ s }: { s: StudioSettings }) {
  const follow = useFollowLink();
  return <StudioHero s={s} live onCta={(link) => follow(link || CATALOG_LINK)} />;
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

export function EngineHeader({
  s,
  logoUrl,
  nav,
  subdomain,
  searchPlaceholder,
}: {
  s: StudioSettings;
  logoUrl: string | null;
  nav: StudioLink[];
  subdomain: string;
  searchPlaceholder: string;
}) {
  const { cartCount } = useStore();
  const { openCart } = useEngineCart();
  const fallback = (
    <div className="search">
      <Search aria-hidden="true" />
      <span>{searchPlaceholder}</span>
    </div>
  );
  return (
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
}

function CategoryTiles({
  s,
  categories,
  style,
  images,
}: {
  s: StudioSettings;
  categories: StudioTileCategory[];
  style: StoreCategoryStyle;
  images: Record<string, string>;
}) {
  const params = useSearchParams();
  const go = useCatalogNav();
  return (
    <StudioCategoriesSection
      s={s}
      categories={categories}
      style={style}
      images={images}
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
}) {
  return (
    <div id={categoriesAnchor(sectionId)} data-eng-anchor={ANCHOR_KIND.categories}>
      <Suspense fallback={null}>
        <CategoryTiles {...props} />
      </Suspense>
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
          onViewDetail={(p) => router.push(`/products/${encodeURIComponent(p.id)}`)}
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
}: {
  sectionId: string;
  s: StudioSettings;
  products: StoreItem[];
  /** Product rail: a carousel the phone kit turns into a swipe row. */
  isRow: boolean;
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

  const action: StudioLink = {
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
          onViewDetail={(p) => router.push(`/products/${encodeURIComponent(p.id)}`)}
          highlight={source === 'bestsellers' && i < BESTSELLER_BADGES && (item.sold_count ?? 0) > 0 ? 'Bestseller' : undefined}
        />
      ))}
    </StudioProductsSection>
  );
}
