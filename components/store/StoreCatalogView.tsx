'use client';

import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { StoreShell } from './StoreShell';
import { StoreProductCard, type StoreProduct } from './StoreProductCard';
import { StoreCartDrawer } from './StoreCartDrawer';
import { StoreProductDetailModal } from './StoreProductDetailModal';
import { StoreCheckout, OrderConfirmation } from './StoreCheckout';
import { StoreTrustSection } from './StoreTrustSection';
import { StoreCategoryPills } from './StoreCategoryPills';
import { StoreCategoryMasonry } from './StoreCategoryMasonry';
import { StoreHeroCarousel } from './StoreHeroCarousel';
import { StoreProductShelves } from './StoreProductShelves';
import { chowkInkOn, isAetherPack, isAtelierPack, isChowkPack, isKhatarioPack, isPackChrome, resolveHeroSlides, sanitizeStoreTheme, sectionEnabled, storeCanvas, type StoreOverlayBand, type StoreTheme } from '@/lib/store/store-theme';
import { isStoreOfferItem, storeDiscountPercent } from '@/lib/store/map-store-product';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface StoreCategory {
  id: string;
  name: string;
}

function AetherMarquee({ text, accent }: { text: string; accent: string }) {
  const parts = text
    .split(/\s*[·|•]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bits = parts.length > 0 ? parts : [text];
  const loop = [...bits, ...bits, ...bits, ...bits];
  return (
    <div className="overflow-hidden border-y" style={{ borderColor: `${accent}33` }}>
      <div
        className="store-aether-marquee flex w-max gap-10 py-3 text-[11px] uppercase tracking-[0.28em]"
        style={{ color: accent }}
      >
        {loop.map((bit, i) => (
          <span key={`${bit}-${i}`}>{bit}</span>
        ))}
      </div>
    </div>
  );
}

function StoreOverlayBands({ bands, home, theme }: { bands: StoreOverlayBand[]; home: boolean; theme: StoreTheme }) {
  if (!home || !sectionEnabled(theme, 'overlay') || bands.length === 0) return null;
  const aether = isAetherPack(theme);
  if (aether) {
    return (
      <section className="mx-auto max-w-6xl px-4 pt-16">
        <p className="text-[11px] uppercase tracking-[0.35em]" style={{ color: theme.accent }}>
          Campaigns
        </p>
        <div className="mt-6 grid gap-px md:grid-cols-2">
          {bands.map((band, i) => (
            <div key={`${band.image_url}-${i}`} className="relative min-h-[280px] overflow-hidden bg-[#161310]">
              {band.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={band.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c0b09]/85 via-[#0c0b09]/20 to-transparent" />
              <div className="relative z-10 flex h-full min-h-[280px] flex-col justify-end p-6 text-[#f6f1e8]">
                {band.caption ? <p className="font-noir-display text-3xl leading-none">{band.caption}</p> : null}
                {band.cta ? (
                  <p className="mt-3 text-[11px] uppercase tracking-[0.22em]" style={{ color: theme.accent }}>
                    {band.cta}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }
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

export function StoreCatalogView() {
  const { store, loading: storeLoading, error, selectedBranchId } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const chowk = isChowkPack(theme);
  const atelier = isAtelierPack(theme);
  const khatario = isKhatarioPack(theme);
  const aether = isAetherPack(theme);
  const pack = isPackChrome(theme);
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

  const fetchItems = useCallback(
    async (opts: {
      categoryId?: string | null;
      search?: string;
      pageNum?: number;
      append?: boolean;
    }) => {
      if (!store) return;

      setItemsLoading(true);
      try {
        const params = new URLSearchParams();
        if (opts.categoryId) params.set('category_id', opts.categoryId);
        if (opts.search) params.set('search', opts.search);
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
        if (!opts.append && !opts.categoryId && !opts.search) {
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

  useEffect(() => {
    if (store) {
      setPage(1);
      fetchItems({ categoryId: selectedCategory, search: searchQuery, pageNum: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, selectedBranchId]);

  const handleCategoryChange = useCallback(
    (catId: string | null) => {
      setSelectedCategory(catId);
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
        fetchItems({ categoryId: selectedCategory, search: query, pageNum: 1 });
      }, 350);
    },
    [fetchItems, selectedCategory],
  );

  const handleLoadMore = useCallback(() => {
    const next = page + 1;
    setPage(next);
    fetchItems({
      categoryId: selectedCategory,
      search: searchQuery,
      pageNum: next,
      append: true,
    });
  }, [page, fetchItems, selectedCategory, searchQuery]);

  const offerItems = useMemo(
    () => items.filter(isStoreOfferItem).slice(0, 8),
    [items],
  );

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
  const browsing = Boolean(searchQuery || selectedCategory);
  const productGrid =
    theme.mobile_columns === 3
      ? 'grid grid-cols-3 gap-2 sm:grid-cols-3 lg:grid-cols-4 sm:gap-3'
      : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4';

  const heroSlides = sectionEnabled(theme, 'hero')
    ? resolveHeroSlides(
        theme,
        {
          image_url: store.store_hero_image_url,
          title: store.store_tagline || (aether ? store.name : `Shop from ${store.name}`),
          subtitle:
            theme.hero_subtitle ||
            (aether ? '' : 'Fresh products from your local store. Add to cart in one tap.'),
        },
        device,
      ).map((s, i) =>
        aether && !s.image_url && i === 0 && store.store_hero_image_url
          ? { ...s, image_url: store.store_hero_image_url }
          : s,
      )
    : [];

  const home = !searchQuery && !selectedCategory;
  const popular =
    pack && home ? items.filter((p) => p.image_url).slice(0, atelier ? 4 : 6) : [];
  const promoSlides =
    pack && home
      ? heroSlides.filter((s, i) => i > 0 && s.image_url).slice(0, 2)
      : [];
  const showMasonry = chowk && home && categories.length > 0 && sectionEnabled(theme, 'categories');
  const selectedName = selectedCategory
    ? categories.find((c) => c.id === selectedCategory)?.name
    : null;
  const tinLine = sectionEnabled(theme, 'offers')
    ? offerItems[0]
      ? `Free delivery on orders · ${offerItems[0].name} ${storeDiscountPercent(offerItems[0].mrp, offerItems[0].selling_price)}% off`
      : store.store_tagline?.trim() || ''
    : '';

  const paper = storeCanvas(theme);
  const ink = chowkInkOn(paper);
  const sparseCatalog = items.length > 0 && items.length < 12;
  const chowkGrid =
    theme.mobile_columns === 3
      ? clsx(
          'store-chowk-grid-3 grid grid-cols-3 gap-x-1.5 gap-y-5 sm:grid-cols-3',
          sparseCatalog ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
        )
      : clsx(
          'grid grid-cols-2 gap-x-2.5 gap-y-6 sm:grid-cols-3',
          sparseCatalog ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
        );
  const atelierGrid = clsx(
    'grid grid-cols-2 gap-x-3 gap-y-8',
    sparseCatalog ? 'lg:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3',
  );
  const packGrid = atelier || aether ? atelierGrid : chowkGrid;

  return (
    <>
      <StoreShell
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        showSearch
        onCartOpen={() => setCartOpen(true)}
        padded={!pack}
        hero={
          khatario && home && theme.show_hero && heroSlides.length > 0 ? (
            <StoreHeroCarousel
              slides={heroSlides}
              ctaLabel={theme.hero_cta}
              accent={accent}
              paper={paper}
              variant="khatario"
              onCta={() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' })}
            />
          ) : null
        }
        announcement={
          chowk && tinLine ? (
            <div
              className="truncate px-4 py-1.5 text-[11px] tracking-[0.02em]"
              style={{
                color: ink,
                backgroundColor: `color-mix(in srgb, ${accent} 7%, ${paper})`,
              }}
            >
              {tinLine}
            </div>
          ) : null
        }
        subnav={
          pack && !khatario && !aether && sectionEnabled(theme, 'categories') ? (
            <StoreCategoryPills
              categories={categories}
              selectedId={selectedCategory}
              onSelect={handleCategoryChange}
              accent={accent}
              style={theme.category_style}
              images={theme.category_images}
              variant={atelier ? 'atelier' : 'chowk'}
              paper={paper}
            />
          ) : null
        }
      >
        {pack ? (
          <>
            {home && heroSlides.length > 0 && !khatario ? (
              <StoreHeroCarousel
                slides={heroSlides}
                ctaLabel={theme.hero_cta}
                accent={accent}
                paper={paper}
                variant={aether ? 'aether' : atelier ? 'atelier' : 'chowk'}
                onCta={() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' })}
              />
            ) : null}

            {aether && home && theme.announcement ? (
              <AetherMarquee text={theme.announcement} accent={accent} />
            ) : null}

            {aether && home && sectionEnabled(theme, 'categories') && categories.length > 0 ? (
              <section className="mx-auto max-w-6xl px-4 pt-16">
                <p className="text-[11px] uppercase tracking-[0.35em]" style={{ color: accent }}>
                  The house
                </p>
                <h2 className="font-noir-display mt-2 text-[clamp(1.8rem,4vw,3rem)] leading-none">Rooms</h2>
                <div className="mt-8 grid gap-px md:grid-cols-2">
                  {categories.slice(0, 4).map((c) => {
                    const cover = theme.category_images[c.id] || items.find((p) => p.category_id === c.id)?.image_url;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleCategoryChange(c.id)}
                        className="group relative min-h-[240px] overflow-hidden text-left"
                      >
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={cover}
                            alt=""
                            className="h-full min-h-[240px] w-full object-cover transition-transform duration-700 group-hover:scale-105"
                          />
                        ) : (
                          <div
                            className="min-h-[240px]"
                            style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, ${paper})` }}
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0b09]/80 to-transparent" />
                        <span className="absolute bottom-5 left-5 font-noir-display text-2xl text-[#f6f1e8]">{c.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {khatario ? (
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
                    variant="khatario"
                    paper={paper}
                  />
                ) : null}
              </div>
            ) : null}

            <StoreOverlayBands bands={theme.overlay_bands} home={home} theme={theme} />

            {home && theme.show_trust && !atelier && !khatario && !aether ? <StoreTrustSection /> : null}

            {showMasonry ? (
              <StoreCategoryMasonry
                categories={categories}
                images={theme.category_images}
                paper={paper}
                onSelect={(id) => handleCategoryChange(id)}
              />
            ) : null}

            {popular.length > 0 && !aether ? (
              <section className={clsx('mx-auto max-w-6xl px-4', khatario ? 'pt-5' : 'pt-8')}>
                <div className={clsx('flex items-end justify-between gap-3', khatario ? 'mb-3' : 'mb-4')}>
                  <div>
                    <h2 className={atelier ? 'font-atelier-display text-[1.35rem] leading-none' : 'text-[1.05rem] font-semibold'}>
                      {atelier ? 'Trending Now' : 'Popular products'}
                    </h2>
                    {atelier ? (
                      <p className="mt-1 text-[12px]" style={{ opacity: 0.45 }}>
                        Curated from this store
                      </p>
                    ) : null}
                  </div>
                  {atelier ? (
                    <button
                      type="button"
                      className="text-[12px]"
                      style={{ opacity: 0.55 }}
                      onClick={() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' })}
                    >
                      See all
                    </button>
                  ) : null}
                </div>
                {atelier ? (
                  <div className="grid grid-cols-2 gap-3">
                    {popular.map((item) => (
                      <StoreProductCard
                        key={`pop-${item.id}`}
                        product={item}
                        variant="grid"
                        onViewDetail={setDetailProduct}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="store-chowk-rail flex snap-x gap-3 overflow-x-auto pb-1">
                    {popular.map((item) => (
                      <StoreProductCard
                        key={`pop-${item.id}`}
                        product={item}
                        variant="shelf"
                        onViewDetail={setDetailProduct}
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {(atelier || aether) && home && sectionEnabled(theme, 'offers') && offerItems.length > 0 ? (
              <section className="mx-auto max-w-6xl px-4 pt-10">
                <div className="mb-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em]" style={{ color: accent, opacity: 0.7 }}>
                    {aether ? 'Private sale' : 'Flash Drop'}
                  </p>
                  <h2 className={aether ? 'font-noir-display mt-2 text-[clamp(1.8rem,4vw,3rem)] leading-none' : 'font-atelier-display mt-1 text-[1.2rem] leading-none'}>
                    {aether ? 'Offers' : 'Limited pieces'}
                  </h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {offerItems.slice(0, 2).map((item) => (
                    <StoreProductCard key={`flash-${item.id}`} product={item} variant="grid" onViewDetail={setDetailProduct} />
                  ))}
                </div>
              </section>
            ) : null}

            {promoSlides.length > 0 && !atelier && !aether ? (
              <section className={clsx('mx-auto grid max-w-6xl gap-3 px-4 md:grid-cols-2', khatario ? 'pt-3' : 'pt-8')}>
                {promoSlides.map((slide, i) => (
                  <button
                    key={`${slide.image_url}-${i}`}
                    type="button"
                    onClick={() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' })}
                    className="relative h-40 overflow-hidden rounded-[1.5rem] text-left md:h-52"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={slide.image_url} alt="" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 bg-gradient-to-r from-black/55 to-transparent" />
                    {slide.title ? (
                      <span className="absolute bottom-4 left-4 max-w-[70%] font-chowk-display text-2xl leading-[1.05] text-white">
                        {slide.title}
                      </span>
                    ) : null}
                  </button>
                ))}
              </section>
            ) : null}

            {home && theme.show_trust && atelier ? <StoreTrustSection /> : null}

            {home && sectionEnabled(theme, 'featured') && featuredItems.length > 0 ? (
              <section className={clsx('mx-auto max-w-6xl px-4', aether ? 'pt-16' : 'pt-8')}>
                {aether ? (
                  <>
                    <p className="text-[11px] uppercase tracking-[0.35em]" style={{ color: accent }}>
                      This season
                    </p>
                    <h2 className="font-noir-display mt-2 mb-8 text-[clamp(1.8rem,4vw,3rem)] leading-none">Featured</h2>
                  </>
                ) : (
                  <h2 className={clsx(khatario ? 'mb-3 text-[1.05rem] font-semibold' : 'mb-4 text-[1.05rem] font-semibold')}>
                    Featured
                  </h2>
                )}
                <div className={clsx('grid gap-3', aether ? atelierGrid : featuredItems.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                  {featuredItems.map((item) => (
                    <StoreProductCard
                      key={`feat-${item.id}`}
                      product={item}
                      variant={aether || featuredItems.length > 1 ? 'grid' : 'featured'}
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
                    <section key={`shelf-${cat.id}`} className={clsx('mx-auto max-w-6xl px-4', aether ? 'pt-16' : 'pt-8')}>
                      <div className="mb-3 flex items-end justify-between">
                        <h2 className={aether ? 'font-noir-display text-[1.8rem] leading-none' : 'text-[1.05rem] font-semibold'}>
                          {cat.name}
                        </h2>
                        <button type="button" className="text-[12px] opacity-60" onClick={() => handleCategoryChange(cat.id)}>
                          View all
                        </button>
                      </div>
                      <div className={aether ? clsx('grid', atelierGrid) : 'flex gap-3 overflow-x-auto pb-1'}>
                        {row.map((item) => (
                          <StoreProductCard
                            key={item.id}
                            product={item}
                            variant={aether ? 'grid' : 'shelf'}
                            onViewDetail={setDetailProduct}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })
              : null}

            {home && sectionEnabled(theme, 'testimonials') && theme.testimonials.length > 0 ? (
              <section className={clsx('mx-auto max-w-6xl px-4', aether ? 'pt-16' : 'pt-10')}>
                {aether ? (
                  <>
                    <p className="text-[11px] uppercase tracking-[0.35em]" style={{ color: accent }}>
                      Voices
                    </p>
                    <h2 className="font-noir-display mt-2 mb-8 text-[clamp(1.8rem,4vw,3rem)] leading-none">
                      Customer notes
                    </h2>
                  </>
                ) : (
                  <h2 className="mb-4 text-[1.05rem] font-semibold">Customer testimonials</h2>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {theme.testimonials.map((tm, i) => (
                    <blockquote
                      key={i}
                      className={aether ? 'border border-[#c4a46a]/20 p-6 text-sm' : 'rounded-2xl bg-white/80 p-4 text-sm'}
                      style={{ color: ink }}
                    >
                      <p className={clsx('leading-relaxed', aether && 'font-noir-display text-lg')}>“{tm.text}”</p>
                      <footer className="mt-2 text-[12px] opacity-60">~ {tm.name}</footer>
                    </blockquote>
                  ))}
                </div>
              </section>
            ) : null}

            {home && sectionEnabled(theme, 'brand_story') && (theme.brand_story || store.store_about_md) ? (
              <section
                className={clsx(
                  aether ? 'mx-auto max-w-3xl px-4 pt-16 text-base leading-8' : 'mx-auto max-w-3xl px-4 pt-10 text-sm leading-relaxed',
                )}
                style={{ color: ink, opacity: aether ? 0.88 : 0.8 }}
              >
                {aether ? (
                  <>
                    <p className="text-[11px] uppercase tracking-[0.35em]" style={{ color: accent }}>
                      Atelier
                    </p>
                    <h2 className="font-noir-display mt-2 mb-6 text-[clamp(1.8rem,4vw,3rem)] leading-none">Our story</h2>
                  </>
                ) : (
                  <h2 className="mb-3 text-[1.05rem] font-semibold">Our story</h2>
                )}
                <p className="whitespace-pre-wrap">{theme.brand_story || store.store_about_md}</p>
              </section>
            ) : null}

            <div className="mx-auto max-w-6xl px-4">
              <section id="all-products" className="pt-8">
                {searchQuery || selectedCategory ? (
                  <div className="mb-4">
                    <h2 className={atelier || aether ? (aether ? 'font-noir-display text-[1.8rem]' : 'font-atelier-display text-[1.35rem]') : 'text-[1.15rem] font-semibold'}>
                      {selectedName || `Results for “${searchQuery}”`}
                    </h2>
                    <p className="mt-0.5 text-[12px]" style={{ opacity: 0.45 }}>
                      {total} {atelier || aether ? 'curated pieces' : 'products'}
                    </p>
                  </div>
                ) : (
                  <h2 className={atelier || aether ? (aether ? 'mb-8 font-noir-display text-[clamp(1.8rem,4vw,3rem)] leading-none' : 'mb-4 font-atelier-display text-[1.2rem] leading-none') : 'mb-3 text-[1.05rem] font-semibold'}>
                    {aether ? 'The collection' : atelier ? 'The Edit' : 'All products'}
                  </h2>
                )}

                {itemsLoading && items.length === 0 ? (
                  <div className={packGrid}>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className={clsx('animate-pulse rounded-[1.35rem] bg-white', atelier || aether ? 'aspect-[3/4]' : 'aspect-square')}
                      />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <p className="py-10 text-[13px]" style={{ opacity: 0.5 }}>
                    {searchQuery
                      ? `No products found for “${searchQuery}”`
                      : 'No products in this store yet.'}
                  </p>
                ) : (
                  <div
                    className={clsx(packGrid, 'chowk-catalog', itemsLoading && items.length > 0 && 'is-wait')}
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
                      className={clsx(
                        'text-[13px] font-medium disabled:opacity-50',
                        atelier || aether ? 'w-full rounded-full py-3' : 'rounded-full bg-white px-5 py-2 shadow-sm',
                      )}
                      style={
                        atelier || aether
                          ? {
                              color: aether ? '#0c0b09' : ink,
                              backgroundColor: aether ? accent : undefined,
                              border: aether ? undefined : `1px solid color-mix(in srgb, ${ink} 14%, transparent)`,
                            }
                          : { color: ink }
                      }
                    >
                      {itemsLoading ? (
                        <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                      ) : atelier || aether ? (
                        `Discover More (${Math.max(0, total - items.length)})`
                      ) : (
                        'Load more'
                      )}
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </>
        ) : (
          <>
            {theme.show_hero ? (
              <div
                className="-mx-4 mb-5 rounded-b-[1.75rem] px-4 pb-4 pt-3"
                style={{ backgroundColor: accent }}
              >
                <StoreHeroCarousel
                  flush
                  slides={resolveHeroSlides(theme, {
                    image_url: store.store_hero_image_url,
                    title: store.store_tagline || `Shop from ${store.name}`,
                    subtitle: theme.hero_subtitle || 'Fresh products from your local store. Add to cart in one tap.',
                  })}
                  ctaLabel={theme.hero_cta}
                  accent={accent}
                  onCta={() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' })}
                />
              </div>
            ) : null}

            {sectionEnabled(theme, 'categories') ? (
              <StoreCategoryPills
                categories={categories}
                selectedId={selectedCategory}
                onSelect={handleCategoryChange}
                accent={accent}
                style={theme.category_style}
                images={theme.category_images}
              />
            ) : null}

            <StoreOverlayBands bands={theme.overlay_bands} home={home} theme={theme} />

            {home && sectionEnabled(theme, 'featured') && featuredItems.length > 0 ? (
              <section className="mb-6">
                <h2 className="mb-3 text-sm font-semibold text-gray-900">Featured</h2>
                <div className={productGrid}>
                  {featuredItems.map((item) => (
                    <StoreProductCard key={`feat-${item.id}`} product={item} onViewDetail={setDetailProduct} />
                  ))}
                </div>
              </section>
            ) : null}

            {home && sectionEnabled(theme, 'product_shelves') ? (
              <StoreProductShelves shelves={theme.product_shelves} onViewDetail={setDetailProduct} />
            ) : null}

            {!browsing && sectionEnabled(theme, 'offers') && offerItems.length > 0 ? (
              <section className="mb-6">
                <h2 className="mb-3 text-sm font-semibold text-gray-900">Today&apos;s offers</h2>
                <div className={productGrid}>
                  {offerItems.map((item) => (
                    <StoreProductCard key={`offer-${item.id}`} product={item} onViewDetail={setDetailProduct} />
                  ))}
                </div>
              </section>
            ) : null}

            <section id="all-products">
              <h2 className="mb-3 text-sm font-semibold text-gray-900">
                {selectedCategory
                  ? categories.find((c) => c.id === selectedCategory)?.name ?? 'Products'
                  : searchQuery
                    ? `Results for “${searchQuery}”`
                    : 'All products'}
              </h2>

              {itemsLoading && items.length === 0 ? (
                <div className={productGrid}>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-gray-200" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-12 text-center">
                  <p className="text-sm text-gray-500">
                    {searchQuery
                      ? `No products found for “${searchQuery}”`
                      : 'No products in this store yet.'}
                  </p>
                </div>
              ) : (
                <div className={productGrid}>
                  {items.map((item) => (
                    <StoreProductCard key={item.id} product={item} onViewDetail={setDetailProduct} />
                  ))}
                </div>
              )}

              {hasMore ? (
                <div className="mt-5 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={itemsLoading}
                    className="rounded-full border border-gray-200 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {itemsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load more'}
                  </button>
                </div>
              ) : null}
            </section>

            {theme.show_trust ? <StoreTrustSection /> : null}
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
