'use client';

import { useStore } from '@/lib/store/store-context';
import { StoreShell } from './StoreShell';
import { StoreProductCard, type StoreProduct } from './StoreProductCard';
import { StoreCartDrawer } from './StoreCartDrawer';
import { StoreProductDetailModal } from './StoreProductDetailModal';
import { StoreCheckout, OrderConfirmation } from './StoreCheckout';
import { StoreTrustSection } from './StoreTrustSection';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface StoreCategory {
  id: string;
  name: string;
}

function categoryTone(name: string): string {
  const tones = ['bg-emerald-50 text-emerald-800', 'bg-amber-50 text-amber-800', 'bg-sky-50 text-sky-800', 'bg-rose-50 text-rose-800', 'bg-violet-50 text-violet-800'];
  let n = 0;
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i);
  return tones[n % tones.length];
}

export function StoreCatalogView() {
  const { store, loading: storeLoading, error, selectedBranchId } = useStore();
  const accent = (store?.store_theme?.accent as string) || '#16a34a';

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

  return (
    <>
      <StoreShell
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        showSearch
        onCartOpen={() => setCartOpen(true)}
      >
        <section className="relative mb-5 overflow-hidden rounded-2xl bg-gray-900">
          {store.store_hero_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={store.store_hero_image_url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-50"
            />
          ) : null}
          <div className="relative px-5 py-8 md:px-10 md:py-12">
            <p className="text-xl font-semibold text-white md:text-3xl">
              {store.store_tagline || `Shop from ${store.name}`}
            </p>
            <p className="mt-1 max-w-lg text-sm text-white/80">
              Fresh products from your local store. Add to cart in one tap.
            </p>
            <button
              type="button"
              className="mt-4 rounded-full px-5 py-2 text-sm font-semibold text-white"
              style={{ backgroundColor: accent }}
              onClick={() => document.getElementById('all-products')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Shop now
            </button>
          </div>
        </section>

        {categories.length > 0 ? (
          <section id="categories" className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Shop by category</h2>
            <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide lg:flex-wrap lg:overflow-visible">
              <button
                type="button"
                onClick={() => handleCategoryChange(null)}
                className={clsx(
                  'flex w-20 flex-shrink-0 flex-col items-center gap-1.5',
                  selectedCategory === null ? 'opacity-100' : 'opacity-80',
                )}
              >
                <span
                  className={clsx(
                    'flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold',
                    selectedCategory === null ? 'ring-2 ring-offset-2' : 'bg-white text-gray-700 border border-gray-100',
                  )}
                  style={selectedCategory === null ? { backgroundColor: `${accent}22`, color: accent, ['--tw-ring-color' as string]: accent } : undefined}
                >
                  All
                </span>
                <span className="text-[11px] font-medium text-gray-700">All</span>
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategoryChange(cat.id)}
                  className="flex w-20 flex-shrink-0 flex-col items-center gap-1.5"
                >
                  <span
                    className={clsx(
                      'flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-semibold',
                      categoryTone(cat.name),
                      selectedCategory === cat.id && 'ring-2 ring-offset-2',
                    )}
                    style={selectedCategory === cat.id ? { ['--tw-ring-color' as string]: accent } : undefined}
                  >
                    {cat.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="line-clamp-2 text-center text-[11px] font-medium text-gray-700">{cat.name}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {!browsing && offerItems.length > 0 ? (
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Today&apos;s offers</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-gray-200" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-12 text-center">
              <p className="text-sm text-gray-500">
                {searchQuery
                  ? `No products found for “${searchQuery}”`
                  : 'No products in this store yet. Ask the shop to enable “Show in Store” on items.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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

        <StoreTrustSection />
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
