import type { TenantScope } from '@/lib/offline/types';
import type {
  CatalogCustomer,
  CatalogItemSearchResult,
  CatalogSearchOptions,
  CatalogStatus,
  CatalogStockScope,
} from '@/lib/offline/catalog/types';

export interface CatalogRepository {
  upsertItems(
    scope: TenantScope,
    items: CatalogItemSearchResult[],
    stockScope: CatalogStockScope
  ): Promise<void>;
  upsertCustomers(scope: TenantScope, customers: CatalogCustomer[]): Promise<void>;
  searchItems(
    scope: TenantScope,
    query: string,
    options?: CatalogSearchOptions
  ): Promise<CatalogItemSearchResult[]>;
  browseItems(
    scope: TenantScope,
    options?: CatalogSearchOptions
  ): Promise<CatalogItemSearchResult[]>;
  findItemByBarcode(
    scope: TenantScope,
    barcode: string,
    options?: CatalogStockScope
  ): Promise<CatalogItemSearchResult | null>;
  searchCustomers(
    scope: TenantScope,
    query: string,
    limit?: number
  ): Promise<CatalogCustomer[]>;
  listCustomers(scope: TenantScope, limit?: number): Promise<CatalogCustomer[]>;
  getStatus(scope: TenantScope): Promise<CatalogStatus>;
  setSyncTimestamps(
    scope: TenantScope,
    patch: {
      lastFullSyncAt?: number;
      lastItemsDeltaAt?: number;
      lastCustomersDeltaAt?: number;
    }
  ): Promise<void>;
  clearTenant(scope: TenantScope): Promise<void>;
}
