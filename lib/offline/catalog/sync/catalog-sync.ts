import type { TenantScope } from '@/lib/offline/types';
import { isAppOffline } from '@/lib/network/offline-state';
import type { CatalogRepository } from '@/lib/offline/catalog/catalog-repository';
import { withCatalogRepository } from '@/lib/offline/catalog/catalog-service';
import {
  mapApiCustomerToCatalog,
  mapApiItemToCatalog,
} from '@/lib/offline/catalog/search-helpers';
import type {
  CatalogSyncProgress,
  CatalogStockScope,
} from '@/lib/offline/catalog/types';
import {
  CATALOG_MAX_CUSTOMERS,
  CATALOG_MAX_ITEMS,
  CATALOG_SYNC_PAGE_SIZE,
} from '@/lib/offline/catalog/types';
import { runInvoiceListSync } from '@/lib/offline/invoices/invoice-list-sync';

export interface CatalogSyncOptions {
  scope: TenantScope;
  userId: string;
  stockScope: CatalogStockScope;
  /** ISO timestamp for delta sync; omit for full sync. */
  itemsUpdatedAfter?: string | null;
  customersUpdatedAfter?: string | null;
  onProgress?: (progress: CatalogSyncProgress) => void;
  signal?: AbortSignal;
}

function isoFromMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export async function runCatalogSync(options: CatalogSyncOptions): Promise<void> {
  if (isAppOffline()) {
    throw new Error('Catalog sync requires network');
  }
  return withCatalogRepository((repo) => runCatalogSyncWithRepo(repo, options));
}

async function runCatalogSyncWithRepo(
  repo: CatalogRepository,
  options: CatalogSyncOptions
): Promise<void> {
  const { scope, userId, stockScope, signal } = options;
  const now = Date.now();
  let itemsSynced = 0;
  let customersSynced = 0;
  let invoicesSynced = 0;

  const report = (phase: CatalogSyncProgress['phase'], message?: string) => {
    options.onProgress?.({
      phase,
      itemsSynced,
      customersSynced,
      invoicesSynced,
      message,
    });
  };

  report('items', 'Syncing items…');

  let page = 1;
  let totalItems: number | undefined;
  const wh = stockScope.warehouseId
    ? `&warehouse_id=${encodeURIComponent(stockScope.warehouseId)}`
    : '';
  const br =
    stockScope.branchId && stockScope.branchId !== 'ALL'
      ? `&branch_id=${encodeURIComponent(stockScope.branchId)}`
      : '';
  const itemsDelta = options.itemsUpdatedAfter
    ? `&updated_after=${encodeURIComponent(options.itemsUpdatedAfter)}`
    : '';

  while (true) {
    if (signal?.aborted) throw new Error('Catalog sync aborted');
    const url =
      `/api/offline-sync/catalog/items?business_id=${encodeURIComponent(scope.businessId)}` +
      `&user_id=${encodeURIComponent(userId)}&page=${page}&limit=${CATALOG_SYNC_PAGE_SIZE}${wh}${br}${itemsDelta}`;
    const res = await fetch(url, { credentials: 'include', signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error ?? `Catalog items sync failed (${res.status})`
      );
    }
    const data = (await res.json()) as {
      items: Record<string, unknown>[];
      pagination?: { total?: number; totalPages?: number };
    };
    const batch = (data.items ?? []).map(mapApiItemToCatalog);
    if (batch.length === 0) break;
    await repo.upsertItems(scope, batch, stockScope);
    itemsSynced += batch.length;
    totalItems = data.pagination?.total;
    report('items', `Items ${itemsSynced}${totalItems ? ` / ${totalItems}` : ''}`);
    if (itemsSynced >= CATALOG_MAX_ITEMS) {
      report('items', `Item cap (${CATALOG_MAX_ITEMS}) reached`);
      break;
    }
    if (
      data.pagination?.totalPages != null &&
      page >= data.pagination.totalPages
    ) {
      break;
    }
    if (batch.length < CATALOG_SYNC_PAGE_SIZE) break;
    page += 1;
  }

  report('customers', 'Syncing customers…');
  page = 1;
  const customersDelta = options.customersUpdatedAfter
    ? `&updated_after=${encodeURIComponent(options.customersUpdatedAfter)}`
    : '';

  while (true) {
    if (signal?.aborted) throw new Error('Catalog sync aborted');
    const url =
      `/api/offline-sync/catalog/customers?business_id=${encodeURIComponent(scope.businessId)}` +
      `&user_id=${encodeURIComponent(userId)}&page=${page}&limit=${CATALOG_SYNC_PAGE_SIZE}${customersDelta}`;
    const res = await fetch(url, { credentials: 'include', signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error ?? `Catalog customers sync failed (${res.status})`
      );
    }
    const data = (await res.json()) as {
      customers: Record<string, unknown>[];
      pagination?: { total?: number; totalPages?: number };
    };
    const batch = (data.customers ?? []).map(mapApiCustomerToCatalog);
    if (batch.length === 0) break;
    await repo.upsertCustomers(scope, batch);
    customersSynced += batch.length;
    report('customers', `Customers ${customersSynced}`);
    if (customersSynced >= CATALOG_MAX_CUSTOMERS) break;
    if (
      data.pagination?.totalPages != null &&
      page >= data.pagination.totalPages
    ) {
      break;
    }
    if (batch.length < CATALOG_SYNC_PAGE_SIZE) break;
    page += 1;
  }

  report('invoices', 'Syncing recent invoices…');
  try {
    invoicesSynced = await runInvoiceListSync({
      scope,
      userId,
      branchId: stockScope.branchId ?? null,
      signal,
    });
    report('invoices', `Invoices ${invoicesSynced} cached`);
  } catch (err) {
    // Invoice list cache is optional — catalog items/customers still usable offline.
    const message = err instanceof Error ? err.message : 'Invoice cache failed';
    report('invoices', message);
  }

  const isFull = !options.itemsUpdatedAfter && !options.customersUpdatedAfter;
  await repo.setSyncTimestamps(scope, {
    ...(isFull ? { lastFullSyncAt: now } : {}),
    lastItemsDeltaAt: now,
    lastCustomersDeltaAt: now,
  });

  report('done', 'Catalog sync complete');
}

export async function runDeltaCatalogSync(
  options: Omit<CatalogSyncOptions, 'itemsUpdatedAfter' | 'customersUpdatedAfter'>
): Promise<void> {
  return withCatalogRepository(async (repo) => {
    const status = await repo.getStatus(options.scope);
    return runCatalogSyncWithRepo(repo, {
      ...options,
      itemsUpdatedAfter: isoFromMs(status.lastItemsDeltaAt),
      customersUpdatedAfter: isoFromMs(status.lastCustomersDeltaAt),
    });
  });
}

export async function runFullCatalogSync(
  options: Omit<CatalogSyncOptions, 'itemsUpdatedAfter' | 'customersUpdatedAfter'>
): Promise<void> {
  return runCatalogSync(options);
}
