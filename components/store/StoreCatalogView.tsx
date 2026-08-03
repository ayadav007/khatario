'use client';

import { useStore } from '@/lib/store/store-context';
import { StoreShell } from './StoreShell';
import { StoreProductCard, type StoreProduct } from './StoreProductCard';
import { StoreCartDrawer } from './StoreCartDrawer';
import { StoreProductDetailModal } from './StoreProductDetailModal';
import { StoreCheckout, OrderConfirmation } from './StoreCheckout';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface StoreCategory {
  id: string;
  name: string;
}

export function StoreCatalogView() {
  const { store, loading: storeLoading, error, selectedBranchId } = useStore();

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
        // silent
      } finally {
        setItemsLoading(false);
      }
    },
    [store, selectedBranchId],
  );

  // Load on mount + when branch changes
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
          <p className="mt-2 text-sm text-gray-500">
            {error ?? 'This store is no longer active.'}
          </p>
        </div>
      </div>
    );
  }

  const hasMore = items.length < total;

  return (
    <>
      <StoreShell
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onCartOpen={() => setCartOpen(true)}
      >
        {/* Hero image */}
        {store.store_hero_image_url ? (
          <div className="mb-4 overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={store.store_hero_image_url}
              alt={store.name}
              className="h-40 w-full object-cover"
            />
          </div>
        ) : null}

        {/* Category chips */}
        {categories.length > 0 ? (
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => handleCategoryChange(null)}
              className={clsx(
                'flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                selectedCategory === null
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategoryChange(cat.id)}
                className={clsx(
                  'flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                  selectedCategory === cat.id
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        ) : null}

        {/* Product grid */}
        {itemsLoading && items.length === 0 ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-500">
              {searchQuery
                ? `No products found for "${searchQuery}"`
                : 'No products available in this store yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <StoreProductCard
                key={item.id}
                product={item}
                onViewDetail={setDetailProduct}
              />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore ? (
          <div className="mt-4 flex justify-center">
            <button
              onClick={handleLoadMore}
              disabled={itemsLoading}
              className="rounded-lg border border-gray-200 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {itemsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Load more'
              )}
            </button>
          </div>
        ) : null}
      </StoreShell>

      {/* Cart drawer */}
      <StoreCartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          setCartOpen(false);
          setCheckoutOpen(true);
        }}
      />

      {/* Checkout */}
      <StoreCheckout
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onOrderPlaced={(orderNumber, grandTotal) => {
          setCheckoutOpen(false);
          setOrderConfirm({ orderNumber, grandTotal });
        }}
      />

      {/* Order confirmation */}
      {orderConfirm ? (
        <OrderConfirmation
          orderNumber={orderConfirm.orderNumber}
          grandTotal={orderConfirm.grandTotal}
          storeName={store?.name ?? ''}
          storePhone={store?.phone ?? null}
          onClose={() => setOrderConfirm(null)}
        />
      ) : null}

      {/* Product detail modal */}
      {detailProduct ? (
        <StoreProductDetailModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
        />
      ) : null}
    </>
  );
}
