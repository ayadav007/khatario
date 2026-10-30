'use client';

import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { StoreShell } from './StoreShell';
import { StoreProductCard, type StoreProduct } from './StoreProductCard';
import { StoreCartDrawer } from './StoreCartDrawer';
import { StoreProductDetailModal } from './StoreProductDetailModal';
import { StoreCheckout, OrderConfirmation } from './StoreCheckout';
import { StoreCategoryPills } from './StoreCategoryPills';
import { StoreHeroCarousel } from './StoreHeroCarousel';
import { StoreProductShelves } from './StoreProductShelves';
import { StoreAnnouncementBar, resolveAnnouncementText } from './StoreAnnouncementBar';
import { GroceryChips, StoreGroceryHome } from './StoreGroceryHome';
import { StoreStudioHome } from './studio-theme/StoreStudioHome';
import { BROWSE_CATEGORIES_EVENT } from './quick-theme/QuickChrome';
import { useStudioSections } from './studio-theme/StoreStudioChrome';
import { chowkInkOn, chowkOnAccent, isKhatarioPack, resolveHeroSlides, sanitizeStoreTheme, sectionEnabled, storeCanvas, type StoreOverlayBand } from '@/lib/store/store-theme';
import { studioLinkTarget, type StudioLinkTarget } from '@/lib/store/studio-layout';
import { isStoreOfferItem } from '@/lib/store/map-store-product';
import { ActiveFilterChips, CatalogFilterPanel, CatalogSortSelect } from './features/catalog';
import { useCatalogFilters } from './features/catalog/useCatalogFilters';
import { useCatalogData } from './features/catalog/useCatalogData';
import { activeFilterCount, EMPTY_CATALOG_FILTERS } from './features/catalog/catalog-filters';
import { migrateLandingParams, removeFilterChip, withSelectedFacets } from './features/catalog/catalog-mount';
import type { SearchPick } from './features/catalog/HeaderSearch';
import { useState, useEffect, useCallback, useRef, useMemo, Suspense, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import clsx from 'clsx';

function StoreOverlayBands({ bands, home, enabled }: { bands: StoreOverlayBand[]; home: boolean; enabled: boolean }) {
  if (!home || !enabled || bands.length === 0) return null;
  return (
    <section className="mx-auto grid max-w-6xl gap-3 px-3 pt-4 sm:px-4 md:grid-cols-2">
      {bands.map((band, i) => (
        <div key={`${band.image_url}-${i}`} className="relative min-h-[160px] overflow-hidden rounded-2xl bg-gray-800">
          {band.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={band.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="relative z-10 flex h-full min-h-[160px] items-end p-4 text-white">
            <p className="text-lg font-medium drop-shadow">{band.caption}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

function scrollToProducts() {
  requestAnimationFrame(() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/** Links from other pages land here as ?nav=<label> or ?browse=; ?category= and ?offers=1 go through migrateLandingParams. */
function readLandingParams() {
  if (typeof window === 'undefined') return { nav: null, browse: false };
  const p = new URLSearchParams(window.location.search);
  return {
    nav: p.get('nav'),
    /** Quick's Categories tab from another page. */
    browse: p.get('browse') === 'categories',
  };
}

function CatalogLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );
}

/** The catalog filters live in the URL (useSearchParams), which needs a Suspense boundary. */
export function StoreCatalogView() {
  return (
    <Suspense fallback={<CatalogLoading />}>
      <StoreCatalogBody />
    </Suspense>
  );
}

function StoreCatalogBody() {
  const { store, loading: storeLoading, error, selectedBranchId } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const khatario = isKhatarioPack(theme);
  const grocery = theme.pack === 'grocery';
  const studio = !khatario && !grocery;
  const [device, setDevice] = useState<'mobile' | 'desktop'>('desktop');
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const apply = () => setDevice(mq.matches ? 'mobile' : 'desktop');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useCatalogFilters();
  const filterValue = filters.value;
  const setFilters = filters.set;
  // Debounced and stable callers use the latest setter, so they never write stale filters back.
  const setFiltersRef = useRef(setFilters);
  setFiltersRef.current = setFilters;

  // Older links (?category=<id>, ?offers=1) are rewritten onto the filter keys before anything loads.
  const paramsString = searchParams?.toString() ?? '';
  const landingRewrite = useMemo(() => migrateLandingParams(new URLSearchParams(paramsString)), [paramsString]);
  useEffect(() => {
    if (!landingRewrite) return;
    const qs = landingRewrite.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    if (landingRewrite.get('cat') || landingRewrite.get('disc')) scrollToProducts();
  }, [landingRewrite, pathname, router]);

  const catalog = useCatalogData(store && !landingRewrite ? store.store_subdomain : null, filters.apiParams, selectedBranchId);
  const { items, total, categories, loading: itemsLoading, hasMore } = catalog;
  // Selected categories/brands stay listed (and named) even when the current search has none of them.
  const facets = useMemo(
    () => withSelectedFacets(catalog.facets, filters.value, categories),
    [catalog.facets, filters.value, categories],
  );
  // The themes still think in one category / offers / search; the URL may hold more.
  const selectedCategory = filterValue.categoryIds[0] ?? null;
  const offersOnly = filterValue.disc != null;
  const searchQuery = filterValue.q;

  const [featuredItems, setFeaturedItems] = useState<StoreProduct[]>([]);
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderConfirm, setOrderConfirm] = useState<{
    orderNumber: string;
    grandTotal: number;
    note?: string;
  } | null>(null);
  const [detailProduct, setDetailProduct] = useState<StoreProduct | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const pendingNav = useRef<string | null>(null);
  const pendingBrowse = useRef(false);

  // The q our live typing last wrote: its echo must not overwrite what the shopper typed since.
  const writtenQ = useRef<string | null>(null);
  useEffect(() => {
    if (writtenQ.current !== null && searchQuery === writtenQ.current.trim()) {
      writtenQ.current = null;
      return;
    }
    // Anything else (Back, a chip, clear, a pick) is adopted.
    writtenQ.current = null;
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  // Featured products for the home rows; they ignore the filters.
  useEffect(() => {
    if (!store) return;
    let alive = true;
    const featParams = withStoreDraft(new URLSearchParams({ featured: '1', limit: '6' }));
    if (selectedBranchId) featParams.set('branch_id', selectedBranchId);
    fetch(`/api/public/store/${encodeURIComponent(store.store_subdomain)}/items?${featParams}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((featData) => {
        if (alive) setFeaturedItems((featData?.items as StoreProduct[]) ?? []);
      })
      .catch(() => {
        if (alive) setFeaturedItems([]);
      });
    return () => {
      alive = false;
    };
  }, [store, selectedBranchId]);

  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    const landing = readLandingParams();
    pendingNav.current = landing.nav;
    pendingBrowse.current = landing.browse;
  }, []);

  // Navigation (pills, tabs, store nav, category tiles) opens one category: it leaves the offers view and
  // drops the search, as a shop's collection links do. The filter panel refines (several, keeps q).
  // Landing links pass `replace` so they add no history entry.
  const handleCategoryChange = useCallback((catId: string | null, opts?: { replace?: boolean }) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    setFiltersRef.current({ categoryIds: catId ? [catId] : [], disc: null, q: '' }, opts);
  }, []);

  // Studio's header types live: the grid follows after a pause, as before, without a history entry per pause.
  const handleSearchChange = useCallback((query: string) => {
    setSearchDraft(query);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      writtenQ.current = query;
      setFiltersRef.current({ q: query }, { replace: true });
    }, 350);
  }, []);

  // Headers with suggestions: the grid follows on submit.
  const handleSearchSubmit = useCallback((query: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    setFiltersRef.current({ q: query.trim() });
    if (query.trim()) scrollToProducts();
  }, []);

  const handleSearchPick = useCallback((pick: SearchPick) => {
    if (pick.type !== 'category') return;
    setFiltersRef.current({ categoryIds: [pick.id], disc: null, q: '' });
    scrollToProducts();
  }, []);

  const handleLoadMore = catalog.loadMore;

  const clearFilters = useCallback(
    (opts?: { replace?: boolean }) => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      setFiltersRef.current({ ...EMPTY_CATALOG_FILTERS, sort: filterValue.sort }, opts);
    },
    [filterValue.sort],
  );

  const handleStudioNavigate = useCallback(
    (target: StudioLinkTarget, _label?: string, opts?: { replace?: boolean }) => {
      if (target.kind === 'category') {
        handleCategoryChange(target.id, opts);
      } else if (target.kind === 'offers') {
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        setFiltersRef.current({ categoryIds: [], disc: filterValue.disc ?? 10, q: '' }, opts);
      } else if (target.kind === 'href') {
        window.location.href = target.href;
        return;
      } else if (searchQuery || activeFilterCount(filterValue) > 0) {
        clearFilters(opts);
      }
      scrollToProducts();
    },
    [handleCategoryChange, searchQuery, filterValue, clearFilters],
  );

  // Quick's Categories tab opens the category view on the current (or first) category.
  useEffect(() => {
    const open = (opts?: { replace?: boolean }) => {
      const first = selectedCategory ?? categories[0]?.id;
      if (!first) return;
      if (first !== selectedCategory) handleCategoryChange(first, opts);
      window.scrollTo({ top: 0 });
    };
    if (pendingBrowse.current && categories.length > 0) {
      pendingBrowse.current = false;
      open({ replace: true });
    }
    const onBrowse = () => open();
    window.addEventListener(BROWSE_CATEGORIES_EVENT, onBrowse);
    return () => window.removeEventListener(BROWSE_CATEGORIES_EVENT, onBrowse);
  }, [categories, selectedCategory, handleCategoryChange]);

  useEffect(() => {
    const label = pendingNav.current;
    if (!label || categories.length === 0) return;
    pendingNav.current = null;
    handleStudioNavigate(studioLinkTarget(label, categories), label, { replace: true });
  }, [categories, handleStudioNavigate]);

  const offerItems = useMemo(
    () => items.filter(isStoreOfferItem).slice(0, 8),
    [items],
  );
  const studioSections = useStudioSections(theme, store, categories);

  if (storeLoading) return <CatalogLoading />;

  if (error || !store) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900">Store not found</h1>
          <p className="mt-2 text-sm text-gray-500">{error ?? 'This store is no longer active.'}</p>
        </div>
      </div>
    );
  }

  const filterCount = activeFilterCount(filterValue);
  const listing = Boolean(searchQuery) || filterCount > 0;
  const home = !listing;
  const quick = theme.pack === 'quick';

  // Filters: sidebar from lg up, a "Filters (n)" sheet below (always the sheet on Quick); sort in the toolbar; chips above the grid.
  const filterToolbar = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className={clsx(
            'inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 bg-[var(--paper,#fff)] px-3 text-sm font-medium text-gray-900',
            !quick && 'lg:hidden',
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
        </button>
        <div className="ml-auto">
          <CatalogSortSelect value={filterValue.sort} onChange={(sort) => setFilters({ sort })} />
        </div>
      </div>
      <ActiveFilterChips
        value={filterValue}
        facets={facets}
        onRemove={(key, item) => setFilters(removeFilterChip(filterValue, key, item))}
        onClear={filters.clear}
      />
    </div>
  );
  const filterSidebar =
    !quick ? (
      <aside className="hidden w-64 shrink-0 lg:sticky lg:top-4 lg:block">
        <CatalogFilterPanel facets={facets} value={filterValue} onChange={setFilters} layout="sidebar" />
      </aside>
    ) : null;
  // Studio, Quick and grocery draw their own grid: while filtering, the toolbar sits above it and the sidebar beside it.
  const withFilters = (body: ReactNode) =>
    listing ? (
      <>
        <div className="mx-auto max-w-6xl px-4 pt-4">{filterToolbar}</div>
        {filterSidebar ? (
          <div className="mx-auto max-w-[90rem] lg:flex lg:items-start lg:gap-6 lg:px-4 lg:pt-4">
            {filterSidebar}
            <div className="min-w-0 flex-1">{body}</div>
          </div>
        ) : (
          body
        )}
      </>
    ) : (
      body
    );

  const heroSlides = sectionEnabled(theme, 'hero')
    ? resolveHeroSlides(
        theme,
        {
          image_url: store.store_hero_image_url,
          title: store.store_tagline || (grocery ? 'Fresh groceries & daily essentials' : `Shop from ${store.name}`),
          subtitle: theme.hero_subtitle || 'Fresh products from your local store. Add to cart in one tap.',
        },
        device,
      )
    : [];

  const popular = khatario && home ? items.filter((p) => p.image_url).slice(0, 6) : [];
  const promoSlides = khatario && home ? heroSlides.filter((s, i) => i > 0 && s.image_url).slice(0, 2) : [];
  const selectedName =
    filterValue.categoryIds.length === 1 ? categories.find((c) => c.id === selectedCategory)?.name : null;
  const paper = storeCanvas(theme);
  const ink = chowkInkOn(paper);
  const sparseCatalog = items.length > 0 && items.length < 12;
  const khatarioGrid =
    theme.mobile_columns === 3
      ? clsx('store-chowk-grid-3 grid grid-cols-3 gap-x-1.5 gap-y-5 sm:grid-cols-3', sparseCatalog ? 'lg:grid-cols-3' : 'lg:grid-cols-4')
      : clsx('grid grid-cols-2 gap-x-2.5 gap-y-6 sm:grid-cols-3', sparseCatalog ? 'lg:grid-cols-3' : 'lg:grid-cols-4');

  return (
    <>
      <StoreShell
        searchQuery={searchDraft}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
        onSearchPick={handleSearchPick}
        showSearch
        onCartOpen={() => setCartOpen(true)}
        padded={false}
        categories={categories}
        onStudioNavigate={handleStudioNavigate}
        studioNav={{ categoryId: selectedCategory, offers: offersOnly }}
        hero={
          khatario && home && theme.show_hero && heroSlides.length > 0 ? (
            <StoreHeroCarousel
              slides={heroSlides}
              ctaLabel={theme.hero_cta}
              accent={accent}
              paper={paper}
              onCta={scrollToProducts}
            />
          ) : null
        }
        announcement={
          khatario ? (
            <StoreAnnouncementBar
              theme={theme}
              text={resolveAnnouncementText(theme, '')}
              defaultBg={accent}
              defaultFg={chowkOnAccent(accent)}
            />
          ) : null
        }
        subnav={
          grocery && sectionEnabled(theme, 'categories') ? (
            <GroceryChips
              categories={categories}
              selectedId={selectedCategory}
              onSelect={(id) => {
                handleCategoryChange(id);
                if (id) scrollToProducts();
              }}
              accent={accent}
              ink={ink}
            />
          ) : null
        }
      >
        {studio ? (
          withFilters(
            <StoreStudioHome
              store={store}
              theme={theme}
              sections={studioSections}
              items={items}
              categories={categories}
              selectedCategory={selectedCategory}
              offersOnly={offersOnly}
              searchQuery={searchQuery}
              total={total}
              hasMore={hasMore}
              loading={itemsLoading}
              onCategory={handleCategoryChange}
              onClear={() => clearFilters()}
              onNavigate={handleStudioNavigate}
              onLoadMore={handleLoadMore}
              onViewDetail={setDetailProduct}
              quick={theme.pack === 'quick'}
            />,
          )
        ) : grocery ? (
          withFilters(
            <StoreGroceryHome
              store={store}
              theme={theme}
              paper={paper}
              ink={ink}
              items={items}
              featuredItems={featuredItems}
              offerItems={offerItems}
              categories={categories}
              selectedCategory={selectedCategory}
              searchQuery={searchQuery}
              total={total}
              hasMore={hasMore}
              loading={itemsLoading}
              heroSlides={heroSlides}
              onCategory={handleCategoryChange}
              onLoadMore={handleLoadMore}
              onViewDetail={setDetailProduct}
            />,
          )
        ) : (
          <>
            <div className="mx-auto max-w-6xl px-3 pt-3 sm:px-4">
              {store.store_tagline ? (
                <p className="mb-2 text-sm leading-relaxed text-gray-600">{store.store_tagline}</p>
              ) : null}
              {sectionEnabled(theme, 'categories') ? (
                <StoreCategoryPills
                  categories={categories}
                  selectedId={selectedCategory}
                  onSelect={handleCategoryChange}
                  accent={accent}
                  style={theme.category_style}
                  images={theme.category_images}
                  paper={paper}
                />
              ) : null}
            </div>

            <StoreOverlayBands bands={theme.overlay_bands} home={home} enabled={sectionEnabled(theme, 'overlay')} />

            {popular.length > 0 ? (
              <section className="mx-auto max-w-6xl px-4 pt-5">
                <h2 className="mb-3 text-[1.05rem] font-semibold">Popular products</h2>
                <div className="store-chowk-rail flex snap-x gap-3 overflow-x-auto pb-1">
                  {popular.map((item) => (
                    <StoreProductCard key={`pop-${item.id}`} product={item} variant="shelf" onViewDetail={setDetailProduct} />
                  ))}
                </div>
              </section>
            ) : null}

            {promoSlides.length > 0 ? (
              <section className="mx-auto grid max-w-6xl gap-3 px-4 pt-3 md:grid-cols-2">
                {promoSlides.map((slide, i) => (
                  <button
                    key={`${slide.image_url}-${i}`}
                    type="button"
                    onClick={scrollToProducts}
                    className="relative h-40 overflow-hidden rounded-[1.5rem] text-left md:h-52"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={slide.image_url} alt="" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 bg-gradient-to-r from-black/55 to-transparent" />
                    {slide.title ? (
                      <span className="absolute bottom-4 left-4 max-w-[70%] text-2xl font-semibold leading-[1.05] text-white">
                        {slide.title}
                      </span>
                    ) : null}
                  </button>
                ))}
              </section>
            ) : null}

            {home && sectionEnabled(theme, 'featured') && featuredItems.length > 0 ? (
              <section className="mx-auto max-w-6xl px-4 pt-8">
                <h2 className="mb-3 text-[1.05rem] font-semibold">Featured</h2>
                <div className={clsx('grid gap-3', featuredItems.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                  {featuredItems.map((item) => (
                    <StoreProductCard
                      key={`feat-${item.id}`}
                      product={item}
                      variant={featuredItems.length > 1 ? 'grid' : 'featured'}
                      onViewDetail={setDetailProduct}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {home && sectionEnabled(theme, 'product_shelves') ? (
              <div className="mx-auto max-w-6xl px-4">
                <StoreProductShelves shelves={theme.product_shelves} onViewDetail={setDetailProduct} />
              </div>
            ) : null}

            {home && sectionEnabled(theme, 'category_shelves')
              ? categories.map((cat) => {
                  const row = items.filter((p) => p.category_id === cat.id).slice(0, 8);
                  if (row.length === 0) return null;
                  return (
                    <section key={`shelf-${cat.id}`} className="mx-auto max-w-6xl px-4 pt-8">
                      <div className="mb-3 flex items-end justify-between">
                        <h2 className="text-[1.05rem] font-semibold">{cat.name}</h2>
                        <button type="button" className="text-[12px] opacity-60" onClick={() => handleCategoryChange(cat.id)}>
                          View all
                        </button>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {row.map((item) => (
                          <StoreProductCard key={item.id} product={item} variant="shelf" onViewDetail={setDetailProduct} />
                        ))}
                      </div>
                    </section>
                  );
                })
              : null}

            {home && sectionEnabled(theme, 'testimonials') && theme.testimonials.length > 0 ? (
              <section className="mx-auto max-w-6xl px-4 pt-10">
                <h2 className="mb-4 text-[1.05rem] font-semibold">Customer testimonials</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {theme.testimonials.map((tm, i) => (
                    <blockquote key={i} className="rounded-2xl bg-white/80 p-4 text-sm" style={{ color: ink }}>
                      <p className="leading-relaxed">“{tm.text}”</p>
                      <footer className="mt-2 text-[12px] opacity-60">~ {tm.name}</footer>
                    </blockquote>
                  ))}
                </div>
              </section>
            ) : null}

            {home && sectionEnabled(theme, 'brand_story') && (theme.brand_story || store.store_about_md) ? (
              <section className="mx-auto max-w-3xl px-4 pt-10 text-sm leading-relaxed" style={{ color: ink, opacity: 0.8 }}>
                <h2 className="mb-3 text-[1.05rem] font-semibold">Our story</h2>
                <p className="whitespace-pre-wrap">{theme.brand_story || store.store_about_md}</p>
              </section>
            ) : null}

            <div className="mx-auto max-w-6xl px-4">
              <section id="all-products" className="pt-8">
                {listing ? (
                  <div className="mb-4">
                    <h2 className="text-[1.15rem] font-semibold">
                      {selectedName || (searchQuery ? `Results for “${searchQuery}”` : 'Products')}
                    </h2>
                    <p className="mt-0.5 text-[12px]" style={{ opacity: 0.45 }}>
                      {total} products
                    </p>
                  </div>
                ) : (
                  <h2 className="mb-3 text-[1.05rem] font-semibold">All products</h2>
                )}

                <div className="mb-4">{filterToolbar}</div>

                <div className="lg:flex lg:items-start lg:gap-6">
                  {filterSidebar}
                  <div className="min-w-0 flex-1">
                    {itemsLoading && items.length === 0 ? (
                      <div className={khatarioGrid}>
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div key={i} className="aspect-square animate-pulse rounded-[1.35rem] bg-white" />
                        ))}
                      </div>
                    ) : items.length === 0 ? (
                      <p className="py-10 text-[13px]" style={{ opacity: 0.5 }}>
                        {searchQuery
                          ? `No products found for “${searchQuery}”`
                          : listing
                            ? 'No products match these filters.'
                            : 'No products in this store yet.'}
                      </p>
                    ) : (
                      <div
                        className={clsx(khatarioGrid, 'chowk-catalog', itemsLoading && items.length > 0 && 'is-wait')}
                        aria-busy={itemsLoading}
                      >
                        {items.map((item) => (
                          <StoreProductCard key={item.id} product={item} variant="grid" onViewDetail={setDetailProduct} />
                        ))}
                      </div>
                    )}

                    {hasMore ? (
                      <div className="mt-8">
                        <button
                          type="button"
                          onClick={handleLoadMore}
                          disabled={itemsLoading}
                          className="rounded-full bg-white px-5 py-2 text-[13px] font-medium shadow-sm disabled:opacity-50"
                          style={{ color: ink }}
                        >
                          {itemsLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Load more'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </StoreShell>

      <StoreCartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          setCartOpen(false);
          window.location.href = '/checkout';
        }}
      />

      <StoreCheckout
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onOrderPlaced={(orderNumber, grandTotal, note) => {
          setCheckoutOpen(false);
          setOrderConfirm({ orderNumber, grandTotal, note });
        }}
      />

      {orderConfirm ? (
        <OrderConfirmation
          orderNumber={orderConfirm.orderNumber}
          grandTotal={orderConfirm.grandTotal}
          note={orderConfirm.note}
          storeName={store?.name ?? ''}
          storePhone={store?.phone ?? null}
          onClose={() => setOrderConfirm(null)}
        />
      ) : null}

      <CatalogFilterPanel
        facets={facets}
        value={filterValue}
        onChange={setFilters}
        layout="sheet"
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
      />

      {detailProduct ? (
        <StoreProductDetailModal product={detailProduct} onClose={() => setDetailProduct(null)} />
      ) : null}
    </>
  );
}
