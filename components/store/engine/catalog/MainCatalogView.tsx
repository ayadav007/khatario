'use client';

import { Suspense, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { useStore } from '@/lib/store/store-context';
import { ctaTarget, engineCatalogHref, engineProductHref } from '@/lib/store/engine/links';
import { StoreProductCard } from '@/components/store/StoreProductCard';
import { ActiveFilterChips, CatalogFilterPanel, CatalogSortSelect } from '@/components/store/features/catalog';
import { useCatalogFilters } from '@/components/store/features/catalog/useCatalogFilters';
import { useCatalogData } from '@/components/store/features/catalog/useCatalogData';
import { activeFilterCount, toApiParams } from '@/components/store/features/catalog/catalog-filters';
import { removeFilterChip, withSelectedFacets } from '@/components/store/features/catalog/catalog-mount';
import { interleavePromos } from './promo-slots';
import { CategoryRail, RAIL_CSS, useStickyHeaderHeight, type RailCategory } from './CategoryRail';

export interface CatalogPromo {
  id: string;
  image: string;
  heading: string;
  text: string;
  link: string;
  /** Shown after this product (1-based). */
  position: number;
}

export interface MainCatalogSettings {
  columnsDesktop: number;
  columnsMobile: number;
  showFilters: boolean;
  showSort: boolean;
  showCount: boolean;
  fullWidth: boolean;
  /** Categories down the left (`layout: rail`); falls back to the plain grid when there are none. */
  rail: boolean;
}

// Columns follow the store container (the engine root is `container: store`), like the other engine sections.
const GRID_CSS =
  '.eng-catalog-grid{display:grid;gap:24px 10px;grid-template-columns:repeat(var(--eng-cols-m),minmax(0,1fr))}' +
  '@container store (min-width: 640px){.eng-catalog-grid{grid-template-columns:repeat(min(3,var(--eng-cols-d)),minmax(0,1fr))}}' +
  '@container store (min-width: 1024px){.eng-catalog-grid{gap:28px 16px;grid-template-columns:repeat(var(--eng-cols-d),minmax(0,1fr))}}';

const BUTTON =
  'inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 bg-[var(--paper,#fff)] px-3 text-sm font-medium text-gray-900';

function PromoTile({ promo }: { promo: CatalogPromo }) {
  const router = useRouter();
  const target = ctaTarget(promo.link);
  const body = (
    <>
      {promo.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={promo.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <div className={`absolute inset-0 ${promo.image ? 'bg-gradient-to-t from-black/65 via-black/15 to-transparent' : ''}`} />
      <div className="relative mt-auto p-4">
        {promo.heading ? <p className="text-lg font-semibold leading-tight">{promo.heading}</p> : null}
        {promo.text ? <p className="mt-1 text-sm opacity-90">{promo.text}</p> : null}
      </div>
    </>
  );
  const className = `relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl text-left ${
    promo.image ? 'text-white' : 'bg-[var(--c-btn,var(--primary))] text-[var(--c-btn-text,var(--on-primary))]'
  }`;
  if (target.kind === 'none' || target.kind === 'anchor') {
    return (
      <div className={className} data-eng-promo={promo.id}>
        {body}
      </div>
    );
  }
  return (
    <a
      href={target.href}
      className={className}
      data-eng-promo={promo.id}
      onClick={(e) => {
        if (target.kind !== 'internal' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(target.href);
      }}
    >
      {body}
    </a>
  );
}

function MainCatalogBody({
  categoryId,
  settings,
  promos,
  railCategories,
}: {
  categoryId: string | null;
  settings: MainCatalogSettings;
  promos: CatalogPromo[];
  railCategories: RailCategory[];
}) {
  const { store, selectedBranchId } = useStore();
  const router = useRouter();
  const filters = useCatalogFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // A route category always wins over any `cat` in the URL; the shopper sees and edits the other filters.
  const value = useMemo(
    () => (categoryId ? { ...filters.value, categoryIds: [] } : filters.value),
    [categoryId, filters.value],
  );
  const apiParams = useMemo(
    () => (categoryId ? toApiParams({ ...filters.value, categoryIds: [categoryId] }).toString() : filters.apiParams),
    [categoryId, filters.value, filters.apiParams],
  );

  const catalog = useCatalogData(store?.store_subdomain ?? null, apiParams, selectedBranchId);
  const { items, total, loading, hasMore } = catalog;
  const rail = settings.rail && railCategories.length > 0;
  const railTop = useStickyHeaderHeight();
  const facets = useMemo(() => {
    const all = withSelectedFacets(catalog.facets, value, catalog.categories);
    // A locked category has no category facet, and the rail is the category picker.
    return categoryId || rail ? { ...all, categories: [] } : all;
  }, [catalog.facets, catalog.categories, value, categoryId, rail]);
  // The rail shows one category at a time: the route's, else the single `cat` filter, else "All".
  const railSelected = categoryId ?? (filters.value.categoryIds.length === 1 ? filters.value.categoryIds[0] : null);
  const railName = railCategories.find((c) => c.id === railSelected)?.name ?? 'All products';
  const pickCategory = (id: string | null) => {
    // On /catalog/[category] the category is the route, so another one is another page.
    if (categoryId) router.push(engineCatalogHref(window.location.search, { categoryId: id }));
    else filters.set({ categoryIds: id ? [id] : [] });
    const top = document.querySelector('.eng-rail')?.getBoundingClientRect().top;
    if (top !== undefined && top < railTop) window.scrollBy({ top: top - railTop });
  };

  const filterCount = activeFilterCount(value);
  const slots = useMemo(() => interleavePromos(items, promos, !hasMore), [items, promos, hasMore]);
  const open = (id: string) => router.push(engineProductHref(window.location.search, id));

  const toolbar = (
    <div className="mb-4 space-y-3">
      {rail ? (
        <p className="text-sm font-semibold">
          {settings.showCount && !(loading && items.length === 0) ? `${total} ${total === 1 ? 'item' : 'items'} in ${railName}` : railName}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {settings.showFilters ? (
          <button type="button" onClick={() => setFiltersOpen(true)} className={`${BUTTON} ${rail ? '' : 'lg:hidden'}`}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
          </button>
        ) : null}
        {settings.showCount && !rail ? (
          <p className="text-sm" style={{ opacity: 0.65 }} aria-live="polite">
            {loading && items.length === 0 ? '' : `${total} ${total === 1 ? 'product' : 'products'}`}
          </p>
        ) : null}
        {settings.showSort ? (
          <div className="ml-auto">
            <CatalogSortSelect value={value.sort} onChange={(sort) => filters.set({ sort })} />
          </div>
        ) : null}
      </div>
      {settings.showFilters ? (
        <ActiveFilterChips
          value={value}
          facets={facets}
          onRemove={(key, item) => filters.set(removeFilterChip(value, key, item))}
          onClear={filters.clear}
        />
      ) : null}
    </div>
  );

  let grid;
  if (loading && items.length === 0) {
    grid = (
      <div className="eng-catalog-grid" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-2xl bg-black/5" />
        ))}
      </div>
    );
  } else if (catalog.error) {
    grid = (
      <div role="alert" className="flex items-center gap-3 py-10 text-sm">
        <span style={{ opacity: 0.6 }}>Couldn&apos;t load products.</span>
        <button type="button" onClick={catalog.retry} className={BUTTON}>
          Retry
        </button>
      </div>
    );
  } else if (items.length === 0) {
    grid = (
      <p className="py-10 text-sm" style={{ opacity: 0.6 }}>
        No products match these filters.
      </p>
    );
  } else {
    grid = (
      <div className="eng-catalog-grid" aria-busy={loading}>
        {slots.map((slot) =>
          slot.kind === 'item' ? (
            <StoreProductCard key={slot.item.id} product={slot.item} variant="grid" onViewDetail={(p) => open(p.id)} />
          ) : (
            <PromoTile key={promos[slot.index].id} promo={promos[slot.index]} />
          ),
        )}
      </div>
    );
  }

  const more =
    hasMore && !catalog.error && items.length > 0 ? (
      <div className="mt-8 flex justify-center">
        <button type="button" onClick={catalog.loadMore} disabled={loading} className={`${BUTTON} px-5 disabled:opacity-50`}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" /> : 'Load more'}
        </button>
      </div>
    ) : null;
  const filterSheet = settings.showFilters ? (
    <CatalogFilterPanel
      facets={facets}
      value={value}
      onChange={filters.set}
      layout="sheet"
      open={filtersOpen}
      onClose={() => setFiltersOpen(false)}
    />
  ) : null;

  if (rail) {
    return (
      <div
        className="eng-rail"
        style={
          {
            '--eng-cols-d': Math.min(settings.columnsDesktop, 4),
            '--eng-cols-m': Math.min(settings.columnsMobile, 2),
            '--eng-rail-top': `${railTop}px`,
          } as CSSProperties
        }
      >
        <style dangerouslySetInnerHTML={{ __html: GRID_CSS + RAIL_CSS }} />
        <CategoryRail categories={railCategories} selected={railSelected} onPick={pickCategory} />
        <div className="eng-rail-main">
          {toolbar}
          {grid}
          {more}
        </div>
        {filterSheet}
      </div>
    );
  }

  return (
    <div
      className={settings.fullWidth ? 'px-4 sm:px-8' : 'mx-auto max-w-6xl px-4 sm:px-8'}
      style={{ '--eng-cols-d': settings.columnsDesktop, '--eng-cols-m': settings.columnsMobile } as CSSProperties}
    >
      <style dangerouslySetInnerHTML={{ __html: GRID_CSS }} />
      {toolbar}
      <div className="lg:flex lg:items-start lg:gap-6">
        {settings.showFilters ? (
          <aside className="hidden w-64 shrink-0 lg:sticky lg:top-4 lg:block">
            <CatalogFilterPanel facets={facets} value={value} onChange={filters.set} layout="sidebar" />
          </aside>
        ) : null}
        <div className="min-w-0 flex-1">
          {grid}
          {more}
        </div>
      </div>
      {filterSheet}
    </div>
  );
}

/**
 * The catalog grid (D14, D18): project C's filters, sort and data hooks over the URL, with the route's
 * category forced into the query, promo tiles placed after product N, and "Load more" paging.
 */
export function MainCatalogView(props: {
  categoryId: string | null;
  settings: MainCatalogSettings;
  promos: CatalogPromo[];
  railCategories: RailCategory[];
}) {
  // The filters live in the URL (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <MainCatalogBody {...props} />
    </Suspense>
  );
}
