import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CatalogCustomer, CatalogItemSearchResult } from '@/lib/offline/catalog/types';

export const CATALOG_IDB_NAME = 'khatario_catalog_v1';
export const CATALOG_IDB_VERSION = 1;

interface CatalogMetaRow {
  key: string;
  value: string;
}

interface CatalogItemRow {
  rowId: string;
  itemId: string;
  businessId: string;
  userId: string;
  searchText: string;
  stockScopeKey: string;
  updatedAt: string;
  item: CatalogItemSearchResult;
}

interface CatalogCustomerRow {
  rowId: string;
  customerId: string;
  businessId: string;
  userId: string;
  searchText: string;
  updatedAt: string;
  customer: CatalogCustomer;
}

interface CatalogDbSchema extends DBSchema {
  meta: {
    key: string;
    value: CatalogMetaRow;
  };
  items: {
    key: string;
    value: CatalogItemRow;
    indexes: {
      'by-tenant': [string, string];
      'by-tenant-scope': [string, string, string];
    };
  };
  customers: {
    key: string;
    value: CatalogCustomerRow;
    indexes: {
      'by-tenant': [string, string];
    };
  };
}

let dbPromise: Promise<IDBPDatabase<CatalogDbSchema>> | null = null;

export function tenantPrefix(businessId: string, userId: string): string {
  return `${businessId}:${userId}`;
}

export function itemRowId(
  businessId: string,
  userId: string,
  itemId: string,
  stockScopeKey: string
): string {
  return `${businessId}:${userId}:${stockScopeKey}:${itemId}`;
}

export function customerRowId(
  businessId: string,
  userId: string,
  customerId: string
): string {
  return `${businessId}:${userId}:${customerId}`;
}

export function stockScopeKey(scope: {
  warehouseId?: string | null;
  branchId?: string | null;
}): string {
  if (scope.warehouseId) return `wh:${scope.warehouseId}`;
  if (scope.branchId && scope.branchId !== 'ALL') return `br:${scope.branchId}`;
  return 'default';
}

export async function getCatalogIdb(): Promise<IDBPDatabase<CatalogDbSchema>> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available');
  }
  if (!dbPromise) {
    dbPromise = openDB<CatalogDbSchema>(CATALOG_IDB_NAME, CATALOG_IDB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('items')) {
          const items = db.createObjectStore('items', { keyPath: 'rowId' });
          items.createIndex('by-tenant', ['businessId', 'userId']);
          items.createIndex('by-tenant-scope', ['businessId', 'userId', 'stockScopeKey']);
        }
        if (!db.objectStoreNames.contains('customers')) {
          const customers = db.createObjectStore('customers', { keyPath: 'rowId' });
          customers.createIndex('by-tenant', ['businessId', 'userId']);
        }
      },
    });
  }
  return dbPromise;
}

export type { CatalogItemRow, CatalogCustomerRow, CatalogMetaRow };
