import type { TenantScope } from '@/lib/offline/types';
import { isAppOffline } from '@/lib/network/offline-state';
import { getCatalogRepository } from '@/lib/offline/catalog/catalog-service';
import { withSqliteLabel } from '@/lib/debug/sqlite-probe';
import type {
  CatalogCustomer,
  CatalogItemSearchResult,
  CatalogSearchOptions,
  CatalogStatus,
  CatalogStockScope,
} from '@/lib/offline/catalog/types';

/** True when the device has no link at all (airplane mode / no Wi-Fi). */
export function preferOfflineCatalog(): boolean {
  return isAppOffline();
}

/**
 * True whenever the local catalog is populated — regardless of whether the
 * device reports a network link.  Use this as the read gate so catalog data
 * is served on captive Wi-Fi, metered connections, or any situation where
 * `isAppOffline()` is false but the API is unreachable.
 */
export async function preferCatalogForScope(scope: TenantScope): Promise<boolean> {
  try {
    const repo = await getCatalogRepository();
    const status = await repo.getStatus(scope);
    return status.ready;
  } catch {
    return false;
  }
}

async function withReadyCatalog<T>(
  scope: TenantScope,
  fn: (repo: Awaited<ReturnType<typeof getCatalogRepository>>) => Promise<T>
): Promise<T | null> {
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  if (!status.ready) return null;
  return fn(repo);
}

/** Search local catalog regardless of online/offline flag (when populated). */
export async function searchCatalogItemsLocal(
  scope: TenantScope,
  query: string,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  return withReadyCatalog(scope, (repo) => repo.searchItems(scope, query, options));
}

export async function browseCatalogItemsLocal(
  scope: TenantScope,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  return withReadyCatalog(scope, (repo) => repo.browseItems(scope, options));
}

export async function searchCatalogCustomersLocal(
  scope: TenantScope,
  query: string,
  limit = 20
): Promise<CatalogCustomer[] | null> {
  return withReadyCatalog(scope, (repo) => repo.searchCustomers(scope, query, limit));
}

export async function listCatalogCustomersLocal(
  scope: TenantScope,
  limit = 500
): Promise<CatalogCustomer[] | null> {
  return withReadyCatalog(scope, (repo) => repo.listCustomers(scope, limit));
}

/**
 * Customer search for billing: use local catalog whenever it is populated,
 * regardless of online/offline (Wi‑Fi without internet still needs the cache).
 */
export async function searchCustomersForBilling(
  scope: TenantScope,
  query: string,
  limit = 20
): Promise<CatalogCustomer[] | null> {
  return searchCatalogCustomersLocal(scope, query, limit);
}

export async function getCatalogStatus(scope: TenantScope): Promise<CatalogStatus> {
  return withSqliteLabel('catalog-status', async () => {
    const repo = await getCatalogRepository();
    return repo.getStatus(scope);
  });
}

/**
 * Search items from the local catalog whenever it is populated.
 * Returns null only when the catalog has never been synced (not ready).
 * Does NOT require the device to be fully offline — works on captive Wi-Fi too.
 */
export async function searchOfflineItems(
  scope: TenantScope,
  query: string,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  return withSqliteLabel('catalog-search/items', () =>
    searchCatalogItemsLocal(scope, query, options)
  );
}

/**
 * Browse items from the local catalog whenever it is populated.
 * Returns null only when the catalog has never been synced (not ready).
 */
export async function browseOfflineItems(
  scope: TenantScope,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  return withSqliteLabel('catalog-search/browse', () =>
    browseCatalogItemsLocal(scope, options)
  );
}

/**
 * Find an item by barcode in the local catalog whenever it is populated.
 * Returns null when catalog is not ready.
 */
export async function findOfflineItemByBarcode(
  scope: TenantScope,
  barcode: string,
  stockScope?: CatalogStockScope
): Promise<CatalogItemSearchResult | null> {
  return withSqliteLabel('catalog-search/barcode', async () => {
    const repo = await getCatalogRepository();
    const status = await repo.getStatus(scope);
    if (!status.ready) return null;
    return repo.findItemByBarcode(scope, barcode, stockScope);
  });
}

/**
 * Customer search for flows other than billing (e.g. payments, expenses).
 * Uses local catalog whenever it is populated, same as `searchCustomersForBilling`.
 */
export async function searchOfflineCustomers(
  scope: TenantScope,
  query: string,
  limit = 20
): Promise<CatalogCustomer[] | null> {
  return searchCustomersForBilling(scope, query, limit);
}

export const OFFLINE_CATALOG_EMPTY_HINT =
  'Offline catalog is empty. Connect once while online (open the app on Wi‑Fi) so items and customers can download.';
