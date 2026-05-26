import type { TenantScope } from '@/lib/offline/types';
import { isAppOffline } from '@/lib/network/offline-state';
import { getCatalogRepository } from '@/lib/offline/catalog/catalog-service';
import type {
  CatalogCustomer,
  CatalogItemSearchResult,
  CatalogSearchOptions,
  CatalogStatus,
  CatalogStockScope,
} from '@/lib/offline/catalog/types';

export function preferOfflineCatalog(): boolean {
  return isAppOffline();
}

async function catalogReady(scope: TenantScope): Promise<boolean> {
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  return status.ready;
}

/** Search local catalog regardless of online/offline flag (when populated). */
export async function searchCatalogItemsLocal(
  scope: TenantScope,
  query: string,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  if (!status.ready) return null;
  return repo.searchItems(scope, query, options);
}

export async function browseCatalogItemsLocal(
  scope: TenantScope,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  if (!status.ready) return null;
  return repo.browseItems(scope, options);
}

export async function searchCatalogCustomersLocal(
  scope: TenantScope,
  query: string,
  limit = 20
): Promise<CatalogCustomer[] | null> {
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  if (!status.ready) return null;
  return repo.searchCustomers(scope, query, limit);
}

export async function listCatalogCustomersLocal(
  scope: TenantScope,
  limit = 500
): Promise<CatalogCustomer[] | null> {
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  if (!status.ready) return null;
  return repo.listCustomers(scope, limit);
}

export async function getCatalogStatus(scope: TenantScope): Promise<CatalogStatus> {
  const repo = await getCatalogRepository();
  return repo.getStatus(scope);
}

export async function searchOfflineItems(
  scope: TenantScope,
  query: string,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  if (!preferOfflineCatalog()) return null;
  return searchCatalogItemsLocal(scope, query, options);
}

export async function browseOfflineItems(
  scope: TenantScope,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  if (!preferOfflineCatalog()) return null;
  return browseCatalogItemsLocal(scope, options);
}

export async function findOfflineItemByBarcode(
  scope: TenantScope,
  barcode: string,
  stockScope?: CatalogStockScope
): Promise<CatalogItemSearchResult | null> {
  if (!preferOfflineCatalog()) return null;
  const repo = await getCatalogRepository();
  if (!(await catalogReady(scope))) return null;
  return repo.findItemByBarcode(scope, barcode, stockScope);
}

export async function searchOfflineCustomers(
  scope: TenantScope,
  query: string,
  limit = 20
): Promise<CatalogCustomer[] | null> {
  if (!preferOfflineCatalog()) return null;
  return searchCatalogCustomersLocal(scope, query, limit);
}

export const OFFLINE_CATALOG_EMPTY_HINT =
  'Offline catalog is empty. Connect once while online (open the app on Wi‑Fi) so items and customers can download.';
