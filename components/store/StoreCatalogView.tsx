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
import { useStudioSections } from './studio-theme/StoreStudioChrome';
import { chowkInkOn, chowkOnAccent, isKhatarioPack, resolveHeroSlides, sanitizeStoreTheme, sectionEnabled, storeCanvas, type StoreOverlayBand } from '@/lib/store/store-theme';
import { studioLinkTarget, type StudioLinkTarget } from '@/lib/store/studio-layout';
import { isStoreOfferItem } from '@/lib/store/map-store-product';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface StoreCategory {
  id: string;
  name: string;
  item_count?: number;
}

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

/** Links from other pages land here as ?category=, ?offers=1 or ?nav=<label>. */
function readLandingParams() {
  if (typeof window === 'undefined') return { category: null, offers: false, nav: null };
  const p = new URLSearchParams(window.location.search);
  return {
    category: p.get('category'),
    offers: p.get('offers') === '1',
    nav: p.get('nav'),
  };
}

export function StoreCatalogView() {
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

  const [items, setItems] = useState<StoreProduct[]>([]);
  const [featuredItems, setFeaturedItems] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [offersOnly, setOffersOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemsLoading, setItemsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderConfirm, setOrderConfirm] = useState<{
    orderNumber: string;
    grandTotal: number;
  } | null>(null);
  const [detailProduct, setDetailProduct] = useState<StoreProduct | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const pendingNav = useRef<string | null>(null);

  const fetchItems = useCallback(
    async (opts: {
      categoryId?: string | null;
      search?: string;
      offers?: boolean;
      pageNum?: number;
      append?: boolean;
    }) => {
      if (!store) return;

      setItemsLoading(true);
      try {
        const params = new URLSearchParams();
        if (opts.categoryId) params.set('category_id', opts.categoryId);
        if (opts.search) params.set('search', opts.search);
        if (opts.offers) params.set('discounted', '1');
        if (opts.pageNum && opts.pageNum > 1) params.set('page', String(opts.pageNum));
        if (selectedBranchId) params.set('branch_id', selectedBranchId);
        params.set('limit', '40');

        const res = await fetch(
          `/api/public/store/${encodeURIComponent(store.store_subdomain)}/items?${withStoreDraft(params)}`,
        );
        if (!res.ok) return;
        const data = await res.json();

        if (opts.append) {
          setItems((prev) => [...prev, ...data.items]);
        } else {
          setItems(data.items);
        }
        if (!opts.append && !opts.categoryId && !opts.search && !opts.offers) {
          const featParams = withStoreDraft(new URLSearchParams({ featured: '1', limit: '6' }));
          if (selectedBranchId) featParams.set('branch_id', selectedBranchId);
          const featRes = await fetch(
            `/api/public/store/${encodeURIComponent(store.store_subdomain)}/items?${featParams}`,
          );
          if (featRes.ok) {
            const featData = await featRes.json();
            setFeaturedItems((featData.items as StoreProduct[]) ?? []);
          } else {
            setFeaturedItems([]);
          }
        }
        setCategories(data.categories ?? []);
        setTotal(data.total);
      } catch {
        /* ignore */
      } finally {
        setItemsLoading(false);
      }
    },
    [store, selectedBranchId],
  );

  const landed = useRef(false);
  useEffect(() => {
    if (!store) return;
    let categoryId = selectedCategory;
    let offers = offersOnly;
    if (!landed.current) {
      landed.current = true;
      const landing = readLandingParams();
      if (landing.category) categoryId = landing.category;
      if (landing.offers) offers = true;
      pendingNav.current = landing.nav;
      setSelectedCategory(categoryId);
      setOffersOnly(offers);
      if (categoryId || offers) scrollToProducts();
    }
    setPage(1);
    fetchItems({ categoryId, search: searchQuery, offers, pageNum: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, selectedBranchId]);

  const handleCategoryChange = useCallback(
    (catId: string | null) => {
      setSelectedCategory(catId);
      setOffersOnly(false);
      setPage(1);
      fetchItems({ categoryId: catId, search: searchQuery, pageNum: 1 });
    },
    [fetchItems, searchQuery],
  );

  const handleSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => {
        setPage(1);
        fetchItems({ categoryId: selectedCategory, search: query, offers: offersOnly, pageNum: 1 });
      }, 350);
    },
    [fetchItems, selectedCategory, offersOnly],
  );

  const handleLoadMore = useCallback(() => {
    const next = page + 1;
    setPage(next);
    fetchItems({
      categoryId: selectedCategory,
      search: searchQuery,
      offers: offersOnly,
      pageNum: next,
      append: true,
    });
  }, [page, fetchItems, selectedCategory, searchQuery, offersOnly]);

  const clearFilters = useCallback(() => {
    setSelectedCategory(null);
    setOffersOnly(false);
    setSearchQuery('');
    setPage(1);
    fetchItems({ pageNum: 1 });
  }, [fetchItems]);

  const handleStudioNavigate = useCallback(
    (target: StudioLinkTarget) => {
      if (target.kind === 'category') {
        handleCategoryChange(target.id);
      } else if (target.kind === 'offers') {
        setSelectedCategory(null);
        setOffersOnly(true);
        setPage(1);
        fetchItems({ search: searchQuery, offers: true, pageNum: 1 });
      } else if (target.kind === 'href') {
        window.location.href = target.href;
        return;
      } else if (selectedCategory || offersOnly || searchQuery) {
        clearFilters();
      }
      scrollToProducts();
    },
    [handleCategoryChange, fetchItems, searchQuery, selectedCategory, offersOnly, clearFilters],
  );

  useEffect(() => {
    const label = pendingNav.current;
    if (!label || categories.length === 0) return;
    pendingNav.current = null;
    handleStudioNavigate(studioLinkTarget(label, categories));
  }, [categories, handleStudioNavigate]);

  const offerItems = useMemo(
    () => items.filter(isStoreOfferItem).slice(0, 8),
    [items],
  );
  const studioSections = useStudioSections(theme, store, categories);

  if (storeLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

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

  const hasMore = items.length < total;
  const home = !searchQuery && !selectedCategory && !offersOnly;

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
  const selectedName = selectedCategory ? categories.find((c) => c.id === selectedCategory)?.name : null;
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
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
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
            onClear={clearFilters}
            onNavigate={handleStudioNavigate}
            onLoadMore={handleLoadMore}
            onViewDetail={setDetailProduct}
          />
        ) : grocery ? (
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
          />
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
                {searchQuery || selectedCategory ? (
                  <div className="mb-4">
                    <h2 className="text-[1.15rem] font-semibold">{selectedName || `Results for “${searchQuery}”`}</h2>
                    <p className="mt-0.5 text-[12px]" style={{ opacity: 0.45 }}>
                      {total} products
                    </p>
                  </div>
                ) : (
                  <h2 className="mb-3 text-[1.05rem] font-semibold">All products</h2>
                )}

                {itemsLoading && items.length === 0 ? (
                  <div className={khatarioGrid}>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="aspect-square animate-pulse rounded-[1.35rem] bg-white" />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <p className="py-10 text-[13px]" style={{ opacity: 0.5 }}>
                    {searchQuery ? `No products found for “${searchQuery}”` : 'No products in this store yet.'}
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
        onOrderPlaced={(orderNumber, grandTotal) => {
          setCheckoutOpen(false);
          setOrderConfirm({ orderNumber, grandTotal });
        }}
      />

      {orderConfirm ? (
        <OrderConfirmation
          orderNumber={orderConfirm.orderNumber}
          grandTotal={orderConfirm.grandTotal}
          storeName={store?.name ?? ''}
          storePhone={store?.phone ?? null}
          onClose={() => setOrderConfirm(null)}
        />
      ) : null}

      {detailProduct ? (
        <StoreProductDetailModal product={detailProduct} onClose={() => setDetailProduct(null)} />
      ) : null}
    </>
  );
}
