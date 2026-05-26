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

export async function getCatalogStatus(scope: TenantScope): Promise<CatalogStatus> {
  const repo = await getCatalogRepository();
  return repo.getStatus(scope);
}

export async function searchOfflineItems(
  scope: TenantScope,
  query: string,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  if (!isAppOffline()) return null;
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  if (!status.ready) return null;
  return repo.searchItems(scope, query, options);
}

export async function browseOfflineItems(
  scope: TenantScope,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[] | null> {
  if (!isAppOffline()) return null;
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  if (!status.ready) return null;
  return repo.browseItems(scope, options);
}

export async function findOfflineItemByBarcode(
  scope: TenantScope,
  barcode: string,
  stockScope?: CatalogStockScope
): Promise<CatalogItemSearchResult | null> {
  if (!isAppOffline()) return null;
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  if (!status.ready) return null;
  return repo.findItemByBarcode(scope, barcode, stockScope);
}

export async function searchOfflineCustomers(
  scope: TenantScope,
  query: string,
  limit = 20
): Promise<CatalogCustomer[] | null> {
  if (!isAppOffline()) return null;
  const repo = await getCatalogRepository();
  const status = await repo.getStatus(scope);
  if (!status.ready) return null;
  return repo.searchCustomers(scope, query, limit);
}
