'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Search, Plus, Package, Loader2, Pencil, Filter, X, Tag, Printer, Tags, ChevronDown } from 'lucide-react';
import { ItemMobileCard } from '@/components/items/ItemMobileCard';
import { AdjustItemStockSheet } from '@/components/items/AdjustItemStockSheet';

import Link from 'next/link';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { SplitPaneLayout } from '@/components/layout/SplitPaneLayout';
import { ItemDetailPanel } from '@/components/items/ItemDetailPanel';
import { ModuleSettingsSheet } from '@/components/settings/ModuleSettingsSheet';
import { getModuleSettingsMenu } from '@/lib/module-settings';
import { useAuth } from '@/contexts/AuthContext';
import { Item } from '@/types/database';
import { useRouter, usePathname } from 'next/navigation';
import { useMobileHeaderRightAccessory } from '@/contexts/MobileHeaderTitleContext';
import { useEntityList } from '@/hooks/useEntityList';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { useToastContext } from '@/contexts/ToastContext';
import { usePermissions } from '@/hooks/usePermissions';
import { clsx } from 'clsx';
import { DeleteAction } from '@/components/common/DeleteAction';

const PAGE_SIZE = 50;

type ItemCategory = { id: string; name: string };

function ItemsPage() {
  const { business, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToastContext();
  const { canDelete, isPrimaryAdmin, loading: permissionsLoading } = usePermissions();
  const canDeleteItems = !permissionsLoading && (canDelete('items') || isPrimaryAdmin);
  const moduleSettingsMenu = getModuleSettingsMenu(pathname);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'goods' | 'service'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [moduleSettingsOpen, setModuleSettingsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [deleteModalItem, setDeleteModalItem] = useState<Item | null>(null);
  const [adjustStockItem, setAdjustStockItem] = useState<Item | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  const { data: allItems, loading, refresh } = useEntityList<Item>({
    apiUrl: '/api/items',
    businessId: business?.id ?? null,
    userId: user?.id ?? null,
    responseKey: 'items',
  });

  const filteredItems = useMemo(() => {
    let list = allItems.filter((i) => i.is_active !== false);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          (i.name && i.name.toLowerCase().includes(q)) ||
          (i.code && i.code.toLowerCase().includes(q))
      );
    }
    if (typeFilter !== 'all') {
      list = list.filter((i) => i.item_type === typeFilter);
    }
    if (categoryFilter !== 'all') {
      list = list.filter((i) => i.category_id === categoryFilter);
    }
    return list.filter((item) => {
      if (stockFilter === 'all') return true;
      if (item.item_type === 'service') return false;
      if (stockFilter === 'out') return Number(item.current_stock) <= 0;
      if (stockFilter === 'low') return Number(item.current_stock) <= Number(item.min_stock) && Number(item.current_stock) > 0;
      return true;
    });
  }, [allItems, search, typeFilter, stockFilter, categoryFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, stockFilter, categoryFilter]);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/categories?business_id=${encodeURIComponent(business.id)}&user_id=${encodeURIComponent(user.id)}`,
          { credentials: 'include' }
        );
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.categories)) {
          setCategories(data.categories.map((c: ItemCategory) => ({ id: c.id, name: c.name })));
        }
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, user?.id]);

  useEffect(() => {
    if (mobileSearchOpen) {
      const t = window.setTimeout(() => mobileSearchInputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [mobileSearchOpen]);

  const toggleLowStock = useCallback(() => {
    setStockFilter((prev) => (prev === 'low' ? 'all' : 'low'));
    if (typeFilter === 'service') setTypeFilter('goods');
  }, [typeFilter]);

  const mobileHeaderSearchAccessory = useMemo(
    () => (
      <button
        type="button"
        onClick={() => setMobileSearchOpen((open) => !open)}
        className={clsx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors touch-manipulation',
          mobileSearchOpen
            ? 'bg-slate-100 text-text-primary dark:bg-slate-800'
            : 'text-text-secondary hover:bg-slate-50 hover:text-text-primary dark:hover:bg-slate-800'
        )}
        aria-label={mobileSearchOpen ? 'Close search' : 'Search items'}
        aria-expanded={mobileSearchOpen}
      >
        {mobileSearchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
      </button>
    ),
    [mobileSearchOpen]
  );

  useMobileHeaderRightAccessory(mobileHeaderSearchAccessory);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, page]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));

  useEffect(() => {
    const handleInventoryUpdate = () => {
      refresh();
    };
    window.addEventListener('inventory-updated', handleInventoryUpdate);
    return () => window.removeEventListener('inventory-updated', handleInventoryUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the currently selected item disappears from the list (filter/delete/refresh), close the panel
  useEffect(() => {
    if (selectedItemId && !allItems.some((i) => i.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [allItems, selectedItemId]);

  const requestDeleteItem = (item: Item) => {
    setDeleteModalItem(item);
  };

  const handleAdjustStock = (item: Item) => {
    const hasVariants = !!(item as { has_variants?: boolean }).has_variants;
    const isBundle = !!(item as Item & { is_bundle?: boolean }).is_bundle;
    if (hasVariants || isBundle) {
      router.push(`/inventory-adjustments/new?item_id=${encodeURIComponent(item.id)}`);
      return;
    }
    setAdjustStockItem(item);
  };

  const isDetailOpen = selectedItemId !== null;

  const toolbar = (
    <>
      {/* Filters - Desktop */}
      <Card padding="md" className="hidden md:block mb-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search name / code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="input w-auto text-sm"
            >
              <option value="all">All Types</option>
              <option value="goods">Goods</option>
              <option value="service">Services</option>
            </select>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="input w-auto text-sm max-w-[10rem]"
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>

            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as 'all' | 'low' | 'out')}
              className="input w-auto text-sm"
              disabled={typeFilter === 'service'}
            >
              <option value="all">All Stock</option>
              <option value="low">Low Stock</option>
              <option value="out">Out of Stock</option>
            </select>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const link = document.createElement('a');
                link.href = '/item-import-template.csv';
                link.download = 'item-import-template.csv';
                link.click();
              }}
            >
              Template
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => document.getElementById('item-import-input')?.click()}
              isLoading={importing}
            >
              Import
            </Button>
          </div>
        </div>
      </Card>
    </>
  );

  // Compact list shown in the left rail when detail is open
  const compactList = (
    <Card padding="none" className="overflow-hidden h-full flex flex-col">
      {/* Compact search */}
      <div className="p-3 border-b border-border relative">
        <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search items"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-9 h-9 text-sm w-full"
        />
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
          </div>
        ) : paginatedItems.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-secondary">No items</div>
        ) : (
          paginatedItems.map((item) => {
            const isSelected = item.id === selectedItemId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedItemId(item.id)}
                className={clsx(
                  'w-full text-left p-3 flex items-center gap-3 transition-colors',
                  isSelected
                    ? 'bg-slate-50 dark:bg-slate-800/40 border-l-[3px] border-primary-500'
                    : 'hover:bg-gray-50 dark:hover:bg-slate-800/90 border-l-[3px] border-transparent'
                )}
              >
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="w-9 h-9 rounded-md object-cover border border-border shrink-0"
                  />
                ) : (
                  <div
                    className={clsx(
                      'w-9 h-9 rounded-md flex items-center justify-center border border-border shrink-0',
                      item.item_type === 'service'
                        ? 'bg-slate-50 text-primary-600'
                        : 'bg-slate-50 text-primary-600'
                    )}
                  >
                    {item.item_type === 'service' ? (
                      <Tag className="w-4 h-4" />
                    ) : (
                      <Package className="w-4 h-4" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-text-primary truncate flex items-center gap-1.5">
                    <span className="truncate">{item.name}</span>
                    {(item as Item & { is_bundle?: boolean }).is_bundle && (
                      <span className="shrink-0 text-[9px] uppercase bg-blue-50 text-blue-800 px-1 py-px rounded border border-blue-200 font-bold">
                        Bundle
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text-secondary truncate">
                    {item.code && <span>{item.code}</span>}
                    {item.code && item.barcode && <span> â€¢ </span>}
                    {item.barcode && <span className="font-mono">{item.barcode}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-text-primary">
                    {item.selling_price != null
                      ? `â‚¹${Number(item.selling_price).toLocaleString('en-IN')}`
                      : '-'}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
      {totalPages > 1 && (
        <div className="p-2 border-t border-border flex items-center justify-between text-xs">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-text-primary"
          >
            â€¹ Prev
          </button>
          <span className="text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-text-primary"
          >
            Next â€º
          </button>
        </div>
      )}
    </Card>
  );

  // Full list (table + mobile cards) â€” original experience when no detail panel is open
  const fullList = (
    <Card padding="none" className="overflow-hidden">
      {loading ? (
        <div className="p-12 flex justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr className="table-header border-b border-border">
                  <th className="table-cell text-left py-4 px-6">Item Name</th>
                  <th className="table-cell text-left py-4 px-6">Code</th>
                  <th className="table-cell text-left py-4 px-6">Barcode</th>
                  <th className="table-cell text-left py-4 px-6">HSN</th>
                  <th className="table-cell text-center py-4 px-6">Stock</th>
                  <th className="table-cell text-right py-4 px-6">Selling Price</th>
                  <th className="table-cell text-center py-4 px-6">Tax %</th>
                  <th className="table-cell text-center py-4 px-6">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.length > 0 ? (
                  paginatedItems.map((item) => {
                    const stock = Number(item.current_stock);
                    const minStock = Number(item.min_stock);
                    let stockStatus = 'success';
                    if (stock <= 0) stockStatus = 'error';
                    else if (stock <= minStock) stockStatus = 'warning';

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer transition-colors border-b border-border last:border-0"
                        onClick={() => setSelectedItemId(item.id)}
                      >
                        <td className="table-cell text-left py-4 px-6 font-semibold text-text-primary">
                          <div className="flex items-center gap-3">
                            {item.image_url ? (
                              <img src={item.image_url} alt={item.name} className="w-10 h-10 object-cover rounded-lg border border-border" />
                            ) : (
                              <div className={`w-10 h-10 ${item.item_type === 'service' ? 'bg-slate-50 text-primary-600' : 'bg-slate-50 text-primary-600'} rounded-lg flex items-center justify-center border border-border`}>
                                {item.item_type === 'service' ? <Tag className="w-5 h-5" /> : <Package className="w-5 h-5" />}
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-2">
                                {item.name}
                                {item.item_type === 'service' && (
                                  <span className="text-[10px] uppercase bg-slate-100 text-primary-700 px-1.5 py-0.5 rounded font-bold">Service</span>
                                )}
                                {(item as Item & { is_bundle?: boolean }).is_bundle && (
                                  <span className="text-[10px] uppercase bg-blue-50 text-blue-800 px-1.5 py-0.5 rounded font-bold border border-blue-200">
                                    Bundle
                                  </span>
                                )}
                                {(item as any).has_variants && (
                                  <span className="text-[10px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">Variants</span>
                                )}
                              </div>
                              {item.code && <div className="text-[10px] text-text-muted mt-0.5 font-medium">Code: {item.code}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="table-cell text-left py-4 px-6 text-text-secondary">{item.code || '-'}</td>
                        <td className="table-cell text-left py-4 px-6 text-text-secondary">
                          {item.barcode ? (
                            <div className="flex flex-col">
                              <span className="font-mono text-sm">{item.barcode}</span>
                              {(item as any).barcode_type && (
                                <span className="text-[10px] text-text-muted mt-0.5">{(item as any).barcode_type}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </td>
                        <td className="table-cell text-left py-4 px-6 text-text-secondary">{(item as any).hsn_sac || '-'}</td>
                        <td className="table-cell text-center py-4 px-6">
                          {item.item_type === 'service' ? (
                            <span className="text-text-muted text-xs italic">N/A</span>
                          ) : (
                            <Chip variant={stockStatus as any}>
                              {stock} {item.unit}
                            </Chip>
                          )}
                        </td>
                        <td className="table-cell text-right py-4 px-6 font-bold text-text-primary">
                          {item.selling_price !== null ? `â‚¹ ${Number(item.selling_price).toLocaleString('en-IN')}` : '-'}
                        </td>
                        <td className="table-cell text-center py-4 px-6 text-text-secondary">{item.tax_rate}%</td>
                        <td className="table-cell text-center py-4 px-6">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/items/new?edit=${item.id}`);
                              }}
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <span onClick={(e) => e.stopPropagation()}>
                              <DeleteAction
                                entityName="Item"
                                variant="delete"
                                disabled={!canDeleteItems || !!(item as any).deleted_at}
                                disabledTooltip={
                                  !canDeleteItems
                                    ? "You don't have permission to delete items"
                                    : 'Item is already deleted'
                                }
                                successMessage="Item deleted successfully"
                                confirmMessage={`Remove "${item.name}" from your catalog? It will no longer appear in the item list; past invoices and records stay unchanged.`}
                                deleteFn={async () => {
                                  if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                                  const res = await fetch(`/api/items/${item.id}`, {
                                    method: 'DELETE',
                                    credentials: 'include',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ business_id: business.id, user_id: user.id }),
                                  });
                                  const data = await res.json().catch(() => ({}));
                                  if (!res.ok) throw new Error(data.error || 'Failed to delete item');
                                }}
                                onSuccess={async () => {
                                  if (selectedItemId === item.id) setSelectedItemId(null);
                                  refresh();
                                }}
                              />
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-text-secondary">
                      No items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="space-y-2 bg-gray-50/80 p-2 md:hidden dark:bg-slate-950/40">
            {paginatedItems.length > 0 ? (
              paginatedItems.map((item) => (
                <ItemMobileCard
                  key={item.id}
                  item={item}
                  onOpen={() => setSelectedItemId(item.id)}
                  onAdjustStock={() => handleAdjustStock(item)}
                />
              ))
            ) : (
              <div className="rounded-xl border border-border bg-white py-12 text-center text-text-secondary dark:bg-surface">
                No items found.
              </div>
            )}
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex justify-between items-center p-4 border-t border-border">
          <p className="text-sm text-text-secondary">
            Page {page} of {totalPages} ({filteredItems.length} items)
          </p>
          <div className="flex space-x-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );

  return (
    <div className="space-y-3 md:space-y-6 h-full flex flex-col">
      <ListPageHeader
        title="Items"
        description="Manage your inventory and products"
        showActionsOnMobile
        actions={
          <>
            {moduleSettingsMenu ? (
              <button
                type="button"
                onClick={() => setModuleSettingsOpen(true)}
                className="hidden md:flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                aria-label={moduleSettingsMenu.ariaLabel}
                title={moduleSettingsMenu.ariaLabel}
              >
                <Tags className="h-5 w-5" />
              </button>
            ) : null}
            <Link href="/items/barcodes">
              <Button variant="secondary" className="h-10 px-4">
                <Printer className="w-4 h-4 md:mr-2" />
                <span className="hidden md:inline">Print Barcodes</span>
              </Button>
            </Link>
            <Link href="/items/new" className="hidden md:inline-flex">
              <Button className="h-10 px-4">
                <Plus className="w-4 h-4 mr-2" />
                Add Item
              </Button>
            </Link>
          </>
        }
      />

      {mobileSearchOpen ? (
        <div className="md:hidden -mt-1 border-b border-border bg-surface px-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              ref={mobileSearchInputRef}
              type="search"
              placeholder="Name, code, or HSN"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input h-10 w-full rounded-lg pl-10 pr-9 text-sm"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <PageToolbar className="md:hidden">
        <button
          type="button"
          onClick={toggleLowStock}
          className={clsx(
            'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            stockFilter === 'low'
              ? 'border-slate-300 bg-slate-100 text-text-primary dark:border-slate-600 dark:bg-slate-800'
              : 'border-border bg-white text-text-secondary dark:bg-surface'
          )}
        >
          Low Stock
        </button>
        <div className="relative shrink-0">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="appearance-none rounded-full border border-border bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-text-secondary dark:bg-surface"
            aria-label="Filter by category"
          >
            <option value="all">Select Category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        </div>
        <button
          type="button"
          onClick={() => setShowMobileFilters(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-text-secondary dark:bg-surface"
        >
          <Filter className="h-3.5 w-3.5" />
          Filter By
        </button>
      </PageToolbar>

      {/* Hidden file input for import */}
      <input
        id="item-import-input"
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || !business?.id) return;
          setImporting(true);
          try {
            const text = await file.text();
            const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
            if (lines.length < 2) throw new Error('CSV has no data rows');
            const headers = lines[0].split(',').map((h) => h.trim());
            const itemsToImport = lines.slice(1).map((line) => {
              const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
              const row: any = {};
              headers.forEach((h, idx) => {
                row[h] = cols[idx];
              });
              return {
                name: row.name,
                code: row.code || null,
                barcode: row.barcode || null,
                unit: row.unit || 'PCS',
                item_type: row.item_type || 'goods',
                category_name: row.category_name || null,
                selling_price: Number(row.selling_price || 0),
                purchase_price: Number(row.purchase_price || 0),
                mrp: row.mrp ? Number(row.mrp) : null,
                tax_rate: Number(row.tax_rate || 18),
                hsn_sac: row.hsn_sac || null,
                opening_stock: Number(row.opening_stock || 0),
                min_stock: Number(row.min_stock || 0),
                description: row.description || null,
                image_url: row.image_url || null,
                is_active: row.is_active === undefined ? true : (row.is_active === 'true' || row.is_active === true),
              };
            });

            const res = await fetch('/api/items/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ business_id: business.id, items: itemsToImport }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Import failed');
            toast.success(`Import completed. Success: ${data.success}, Failed: ${data.failed}`);
            setSearch('');
            refresh();
          } catch (err: any) {
            toast.error(err.message || 'Import failed');
          } finally {
            setImporting(false);
            e.target.value = '';
          }
        }}
      />

      {/* Mobile Filter Bottom Sheet */}
      {showMobileFilters && (
        <div className="fixed inset-0 z-[100] md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileFilters(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-surface border-t border-border rounded-t-2xl shadow-xl p-6 animate-slide-up max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-text-primary">Filters</h3>
              <button onClick={() => setShowMobileFilters(false)} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full">
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Category</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="input w-full text-sm"
                >
                  <option value="all">All Categories</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Item Type</label>
                <div className="flex flex-col gap-2">
                  {[
                    { id: 'all', label: 'All Types' },
                    { id: 'goods', label: 'Goods Only' },
                    { id: 'service', label: 'Services Only' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setTypeFilter(t.id as any);
                        if (t.id === 'service') setStockFilter('all');
                      }}
                      className={`px-4 py-3 rounded-xl text-left text-sm font-medium border transition-colors ${
                        typeFilter === t.id
                          ? 'bg-slate-50 dark:bg-primary-900/35 border-primary-500 text-primary-700 dark:text-primary-300'
                          : 'bg-background/50 dark:bg-slate-900/30 border-border text-text-secondary'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {typeFilter !== 'service' && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">Stock Level</label>
                  <div className="flex flex-col gap-2">
                    {[
                      { id: 'all', label: 'All Levels' },
                      { id: 'low', label: 'Low Stock' },
                      { id: 'out', label: 'Out of Stock' },
                    ].map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStockFilter(s.id as any)}
                        className={`px-4 py-3 rounded-xl text-left text-sm font-medium border transition-colors ${
                          stockFilter === s.id
                            ? 'bg-slate-50 dark:bg-primary-900/35 border-primary-500 text-primary-700 dark:text-primary-300'
                            : 'bg-background/50 dark:bg-slate-900/30 border-border text-text-secondary'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border">
                <Button
                  variant="secondary"
                  className="w-full h-12 rounded-xl"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = '/item-import-template.csv';
                    link.download = 'item-import-template.csv';
                    link.click();
                  }}
                >
                  Template
                </Button>
                <Button
                  variant="secondary"
                  className="w-full h-12 rounded-xl"
                  onClick={() => document.getElementById('item-import-input')?.click()}
                  isLoading={importing}
                >
                  Import
                </Button>
              </div>
            </div>

            <Button className="w-full mt-6 h-12 rounded-xl" onClick={() => setShowMobileFilters(false)}>
              Apply Filters
            </Button>
          </div>
        </div>
      )}

      <SplitPaneLayout
        isDetailOpen={isDetailOpen}
        onCloseDetail={() => setSelectedItemId(null)}
        toolbarSlot={toolbar}
        listSlot={isDetailOpen ? compactList : fullList}
        detailSlot={
          selectedItemId ? (
            <ItemDetailPanel
              itemId={selectedItemId}
              onClose={() => setSelectedItemId(null)}
              onDelete={requestDeleteItem}
              canDelete={canDeleteItems}
            />
          ) : null
        }
      />

      {deleteModalItem && (
        <DeleteAction
          entityName="Item"
          variant="delete"
          hideButton
          open={!!deleteModalItem}
          onOpenChange={(next) => {
            if (!next) setDeleteModalItem(null);
          }}
          successMessage="Item deleted successfully"
          confirmMessage={`Remove "${deleteModalItem.name}" from your catalog? It will no longer appear in the item list; past invoices and records stay unchanged.`}
          deleteFn={async () => {
            if (!business?.id || !user?.id) throw new Error('Missing business/user context');
            const res = await fetch(`/api/items/${deleteModalItem.id}`, {
              method: 'DELETE',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ business_id: business.id, user_id: user.id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to delete item');
          }}
          onSuccess={async () => {
            if (selectedItemId === deleteModalItem.id) setSelectedItemId(null);
            refresh();
          }}
        />
      )}

      {moduleSettingsMenu ? (
        <ModuleSettingsSheet
          open={moduleSettingsOpen}
          onClose={() => setModuleSettingsOpen(false)}
          menu={moduleSettingsMenu}
        />
      ) : null}

      <AdjustItemStockSheet
        item={adjustStockItem}
        open={!!adjustStockItem}
        onClose={() => setAdjustStockItem(null)}
        onSuccess={refresh}
      />
    </div>
  );
}

export default withPageAuth('items', 'read', ItemsPage);
