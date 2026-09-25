'use client';

import { useStore } from '@/lib/store/store-context';
import { StoreShell } from './StoreShell';
import { StoreProductCard, type StoreProduct } from './StoreProductCard';
import { StoreCartDrawer } from './StoreCartDrawer';
import { StoreProductDetailModal } from './StoreProductDetailModal';
import { StoreCheckout, OrderConfirmation } from './StoreCheckout';
import { StoreTrustSection } from './StoreTrustSection';
import { StoreCategoryPills } from './StoreCategoryPills';
import { StoreCategoryMasonry } from './StoreCategoryMasonry';
import { StoreHeroCarousel } from './StoreHeroCarousel';
import { chowkInkOn, isChowkPack, resolveHeroSlides, sanitizeStoreTheme } from '@/lib/store/store-theme';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface StoreCategory {
  id: string;
  name: string;
}

export function StoreCatalogView() {
  const { store, loading: storeLoading, error, selectedBranchId } = useStore();
  const theme = sanitizeStoreTheme(store?.store_theme);
  const accent = theme.accent;
  const chowk = isChowkPack(theme);

  const [items, setItems] = useState<StoreProduct[]>([]);
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
          `/api/public/store/${encodeURIComponent(store.store_subdomain)}/items?${params}`,
        );
        if (!res.ok) return;
        const data = await res.json();

        if (opts.append) {
          setItems((prev) => [...prev, ...data.items]);
        } else {
          setItems(data.items);
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
    () =>
      items.filter(
        (p) => p.mrp != null && p.mrp > p.selling_price && p.current_stock > 0,
      ).slice(0, 8),
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

  const heroSlides = theme.show_hero
    ? resolveHeroSlides(theme, {
        image_url: store.store_hero_image_url,
        title: store.store_tagline || '',
        subtitle: theme.hero_subtitle || '',
      })
    : [];

  const home = !searchQuery && !selectedCategory;
  const popular =
    chowk && home ? items.filter((p) => p.image_url).slice(0, 6) : [];
  const promoSlides =
    chowk && home
      ? heroSlides.filter((s, i) => i > 0 && s.image_url).slice(0, 2)
      : [];
  const showMasonry = chowk && home && categories.length > 0;
  const selectedName = selectedCategory
    ? categories.find((c) => c.id === selectedCategory)?.name
    : null;
  const tinLine = theme.show_offers
    ? offerItems[0]
      ? `Free delivery on orders · ${offerItems[0].name} ${Math.round((((offerItems[0].mrp ?? 0) - offerItems[0].selling_price) / (offerItems[0].mrp ?? 1)) * 100)}% off`
      : store.store_tagline?.trim() || ''
    : '';

  const ink = chowkInkOn(theme.background);
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

  return (
    <>
      <StoreShell
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        showSearch
        onCartOpen={() => setCartOpen(true)}
        padded={!chowk}
        announcement={
          chowk && tinLine ? (
            <div
              className="truncate px-4 py-1.5 text-[11px] tracking-[0.02em]"
              style={{
                color: ink,
                backgroundColor: `color-mix(in srgb, ${accent} 7%, ${theme.background})`,
              }}
            >
              {tinLine}
            </div>
          ) : null
        }
        subnav={
          chowk ? (
            <StoreCategoryPills
              categories={categories}
              selectedId={selectedCategory}
              onSelect={handleCategoryChange}
              accent={accent}
              style={theme.category_style}
              images={theme.category_images}
              variant="chowk"
              paper={theme.background}
            />
          ) : null
        }
      >
        {chowk ? (
          <>
            {home && heroSlides.length > 0 ? (
              <StoreHeroCarousel
                slides={heroSlides}
                ctaLabel={theme.hero_cta}
                accent={accent}
                paper={theme.background}
                variant="chowk"
                onCta={() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' })}
              />
            ) : null}

            {home && theme.show_trust ? <StoreTrustSection /> : null}

            {showMasonry ? (
              <StoreCategoryMasonry
                categories={categories}
                images={theme.category_images}
                paper={theme.background}
                onSelect={(id) => handleCategoryChange(id)}
              />
            ) : null}

            {popular.length > 0 ? (
              <section className="mx-auto max-w-6xl px-4 pt-8">
                <h2 className="mb-3 text-[1.05rem] font-semibold">Popular products</h2>
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
              </section>
            ) : null}

            {promoSlides.length > 0 ? (
              <section className="mx-auto grid max-w-6xl gap-3 px-4 pt-8 md:grid-cols-2">
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
                  <div className={chowkGrid}>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="aspect-square animate-pulse rounded-2xl bg-white" />
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
                    className={clsx(chowkGrid, 'chowk-catalog', itemsLoading && items.length > 0 && 'is-wait')}
                    aria-busy={itemsLoading}
                  >
                    {items.map((item) => (
                      <StoreProductCard key={item.id} product={item} variant="grid" onViewDetail={setDetailProduct} />
                    ))}
                  </div>
                )}

                {hasMore ? (
                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={itemsLoading}
                      className="rounded-full bg-white px-5 py-2 text-[13px] font-medium shadow-sm disabled:opacity-50"
                      style={{ color: ink }}
                    >
                      {itemsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load more'}
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </>
        ) : (
          <>
            {theme.show_hero ? (
              <StoreHeroCarousel
                slides={resolveHeroSlides(theme, {
                  image_url: store.store_hero_image_url,
                  title: store.store_tagline || `Shop from ${store.name}`,
                  subtitle: theme.hero_subtitle || 'Fresh products from your local store. Add to cart in one tap.',
                })}
                ctaLabel={theme.hero_cta}
                accent={accent}
                onCta={() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' })}
              />
            ) : null}

            <StoreCategoryPills
              categories={categories}
              selectedId={selectedCategory}
              onSelect={handleCategoryChange}
              accent={accent}
              style={theme.category_style}
              images={theme.category_images}
            />

            {!browsing && theme.show_offers && offerItems.length > 0 ? (
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
