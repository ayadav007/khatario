import type { TenantScope } from '@/lib/offline/types';
import type { CatalogRepository } from '@/lib/offline/catalog/catalog-repository';
import {
  buildCustomerSearchText,
  buildItemSearchText,
  findItemByBarcode as findByBarcode,
  searchCatalogCustomers,
  searchCatalogItems,
} from '@/lib/offline/catalog/search-helpers';
import type {
  CatalogCustomer,
  CatalogItemSearchResult,
  CatalogSearchOptions,
  CatalogStatus,
  CatalogStockScope,
} from '@/lib/offline/catalog/types';
import {
  customerRowId,
  getCatalogIdb,
  itemRowId,
  stockScopeKey,
  type CatalogCustomerRow,
  type CatalogItemRow,
} from '@/lib/offline/catalog/idb/idb-catalog-db';

const META_LAST_FULL = 'lastFullSyncAt';
const META_ITEMS_DELTA = 'lastItemsDeltaAt';
const META_CUSTOMERS_DELTA = 'lastCustomersDeltaAt';
const META_ITEM_COUNT = 'itemCount';
const META_CUSTOMER_COUNT = 'customerCount';
const META_STOCK_SCOPE = 'stockScope';

function metaKey(scope: TenantScope, key: string): string {
  return `${scope.businessId}:${scope.userId}:${key}`;
}

async function readMeta(scope: TenantScope, key: string): Promise<string | null> {
  const db = await getCatalogIdb();
  const row = await db.get('meta', metaKey(scope, key));
  return row?.value ?? null;
}

async function writeMeta(scope: TenantScope, key: string, value: string): Promise<void> {
  const db = await getCatalogIdb();
  await db.put('meta', { key: metaKey(scope, key), value });
}

async function loadItemsForScope(
  scope: TenantScope,
  scopeKey: string
): Promise<CatalogItemSearchResult[]> {
  const db = await getCatalogIdb();
  const idx = db.transaction('items').store.index('by-tenant-scope');
  const range = IDBKeyRange.only([scope.businessId, scope.userId, scopeKey]);
  const rows: CatalogItemRow[] = [];
  let cursor = await idx.openCursor(range);
  while (cursor) {
    rows.push(cursor.value);
    cursor = await cursor.continue();
  }
  return rows.map((row) => row.item);
}

async function loadCustomers(scope: TenantScope): Promise<CatalogCustomer[]> {
  const db = await getCatalogIdb();
  const idx = db.transaction('customers').store.index('by-tenant');
  const range = IDBKeyRange.only([scope.businessId, scope.userId]);
  const rows: CatalogCustomerRow[] = [];
  let cursor = await idx.openCursor(range);
  while (cursor) {
    rows.push(cursor.value);
    cursor = await cursor.continue();
  }
  return rows.map((row) => row.customer);
}

async function loadAllItemsForTenant(scope: TenantScope): Promise<CatalogItemSearchResult[]> {
  const db = await getCatalogIdb();
  const idx = db.transaction('items').store.index('by-tenant');
  const range = IDBKeyRange.only([scope.businessId, scope.userId]);
  const byId = new Map<string, CatalogItemSearchResult>();
  let cursor = await idx.openCursor(range);
  while (cursor) {
    byId.set(cursor.value.item.id, cursor.value.item);
    cursor = await cursor.continue();
  }
  return Array.from(byId.values());
}

async function resolveBrowsableItems(
  scope: TenantScope,
  options?: CatalogSearchOptions
): Promise<CatalogItemSearchResult[]> {
  const scopeKey = stockScopeKey({
    warehouseId: options?.warehouseId,
    branchId: options?.branchId,
  });
  let items = await loadItemsForScope(scope, scopeKey);
  if (items.length === 0 && scopeKey !== 'default') {
    items = await loadItemsForScope(scope, 'default');
  }
  if (items.length === 0) {
    const stockScopeRaw = await readMeta(scope, META_STOCK_SCOPE);
    if (stockScopeRaw) {
      try {
        const parsed = JSON.parse(stockScopeRaw) as CatalogStockScope;
        const metaKey = stockScopeKey(parsed);
        if (metaKey !== scopeKey && metaKey !== 'default') {
          items = await loadItemsForScope(scope, metaKey);
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (items.length === 0) {
    items = await loadAllItemsForTenant(scope);
  }
  return items;
}

export class IdbCatalogDriver implements CatalogRepository {
  async upsertItems(
    scope: TenantScope,
    items: CatalogItemSearchResult[],
    stockScope: CatalogStockScope
  ): Promise<void> {
    const db = await getCatalogIdb();
    const scopeKey = stockScopeKey(stockScope);
    const tx = db.transaction('items', 'readwrite');
    const now = new Date().toISOString();
    for (const item of items) {
      const row: CatalogItemRow = {
        rowId: itemRowId(scope.businessId, scope.userId, item.id, scopeKey),
        itemId: item.id,
        businessId: scope.businessId,
        userId: scope.userId,
        searchText: buildItemSearchText(item),
        stockScopeKey: scopeKey,
        updatedAt: now,
        item,
      };
      await tx.store.put(row);
    }
    await tx.done;
    await writeMeta(scope, META_STOCK_SCOPE, JSON.stringify(stockScope));
  }

  async upsertCustomers(scope: TenantScope, customers: CatalogCustomer[]): Promise<void> {
    const db = await getCatalogIdb();
    const tx = db.transaction('customers', 'readwrite');
    const now = new Date().toISOString();
    for (const customer of customers) {
      const row: CatalogCustomerRow = {
        rowId: customerRowId(scope.businessId, scope.userId, customer.id),
        customerId: customer.id,
        businessId: scope.businessId,
        userId: scope.userId,
        searchText: buildCustomerSearchText(customer),
        updatedAt: now,
        customer,
      };
      await tx.store.put(row);
    }
    await tx.done;
  }

  async searchItems(
    scope: TenantScope,
    query: string,
    options?: CatalogSearchOptions
  ): Promise<CatalogItemSearchResult[]> {
    const items = await resolveBrowsableItems(scope, options);
    return searchCatalogItems(items, query, options?.limit ?? 50);
  }

  async browseItems(
    scope: TenantScope,
    options?: CatalogSearchOptions
  ): Promise<CatalogItemSearchResult[]> {
    const items = await resolveBrowsableItems(scope, options);
    return items
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, options?.limit ?? 120);
  }

  async findItemByBarcode(
    scope: TenantScope,
    barcode: string,
    options?: CatalogStockScope
  ): Promise<CatalogItemSearchResult | null> {
    const items = await resolveBrowsableItems(scope, options);
    const match = findByBarcode(items, barcode);
    if (!match) return null;
    if (match.variant) {
      return {
        ...match.item,
        variantId: match.variant.id,
        variantName: match.variant.variant_name,
        variantAttributes: match.variant.attributes,
        selling_price: match.variant.selling_price ?? match.item.selling_price,
        current_stock: match.variant.current_stock,
      };
    }
    return match.item;
  }

  async searchCustomers(
    scope: TenantScope,
    query: string,
    limit = 20
  ): Promise<CatalogCustomer[]> {
    const customers = await loadCustomers(scope);
    return searchCatalogCustomers(customers, query, limit);
  }

  async listCustomers(scope: TenantScope, limit = 20): Promise<CatalogCustomer[]> {
    const customers = await loadCustomers(scope);
    return customers.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
  }

  async getStatus(scope: TenantScope): Promise<CatalogStatus> {
    const db = await getCatalogIdb();
    const idxItems = db.transaction('items').store.index('by-tenant');
    const idxCustomers = db.transaction('customers').store.index('by-tenant');
    const itemRange = IDBKeyRange.only([scope.businessId, scope.userId]);
    let itemCount = 0;
    let cursor = await idxItems.openCursor(itemRange);
    while (cursor) {
      itemCount += 1;
      cursor = await cursor.continue();
    }
    let customerCount = 0;
    let customerCursor = await idxCustomers.openCursor(itemRange);
    while (customerCursor) {
      customerCount += 1;
      customerCursor = await customerCursor.continue();
    }
    const stockScopeRaw = await readMeta(scope, META_STOCK_SCOPE);
    let stockScope: CatalogStockScope = {};
    if (stockScopeRaw) {
      try {
        stockScope = JSON.parse(stockScopeRaw) as CatalogStockScope;
      } catch {
        stockScope = {};
      }
    }
    const parseNum = async (key: string) => {
      const raw = await readMeta(scope, key);
      return raw ? Number(raw) : null;
    };
    return {
      ready: itemCount > 0 || customerCount > 0,
      itemCount,
      customerCount,
      lastFullSyncAt: await parseNum(META_LAST_FULL),
      lastItemsDeltaAt: await parseNum(META_ITEMS_DELTA),
      lastCustomersDeltaAt: await parseNum(META_CUSTOMERS_DELTA),
      stockScope,
    };
  }

  async setSyncTimestamps(
    scope: TenantScope,
    patch: {
      lastFullSyncAt?: number;
      lastItemsDeltaAt?: number;
      lastCustomersDeltaAt?: number;
    }
  ): Promise<void> {
    if (patch.lastFullSyncAt != null) {
      await writeMeta(scope, META_LAST_FULL, String(patch.lastFullSyncAt));
    }
    if (patch.lastItemsDeltaAt != null) {
      await writeMeta(scope, META_ITEMS_DELTA, String(patch.lastItemsDeltaAt));
    }
    if (patch.lastCustomersDeltaAt != null) {
      await writeMeta(scope, META_CUSTOMERS_DELTA, String(patch.lastCustomersDeltaAt));
    }
  }

  async clearTenant(scope: TenantScope): Promise<void> {
    const db = await getCatalogIdb();
    for (const storeName of ['items', 'customers'] as const) {
      const tx = db.transaction(storeName, 'readwrite');
      const idx = tx.store.index('by-tenant');
      const range = IDBKeyRange.only([scope.businessId, scope.userId]);
      let cursor = await idx.openCursor(range);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    }
    const metaTx = db.transaction('meta', 'readwrite');
    const prefix = `${scope.businessId}:${scope.userId}:`;
    let metaCursor = await metaTx.store.openCursor();
    while (metaCursor) {
      if (metaCursor.key.startsWith(prefix)) {
        await metaCursor.delete();
      }
      metaCursor = await metaCursor.continue();
    }
    await metaTx.done;
  }
}

export async function setCatalogSyncMeta(
  scope: TenantScope,
  patch: {
    lastFullSyncAt?: number;
    lastItemsDeltaAt?: number;
    lastCustomersDeltaAt?: number;
    itemCount?: number;
    customerCount?: number;
  }
): Promise<void> {
  const driver = new IdbCatalogDriver();
  const db = await getCatalogIdb();
  void driver;
  if (patch.lastFullSyncAt != null) {
    await writeMeta(scope, META_LAST_FULL, String(patch.lastFullSyncAt));
  }
  if (patch.lastItemsDeltaAt != null) {
    await writeMeta(scope, META_ITEMS_DELTA, String(patch.lastItemsDeltaAt));
  }
  if (patch.lastCustomersDeltaAt != null) {
    await writeMeta(scope, META_CUSTOMERS_DELTA, String(patch.lastCustomersDeltaAt));
  }
  if (patch.itemCount != null) {
    await writeMeta(scope, META_ITEM_COUNT, String(patch.itemCount));
  }
  if (patch.customerCount != null) {
    await writeMeta(scope, META_CUSTOMER_COUNT, String(patch.customerCount));
  }
  void db;
}

export const idbCatalogDriver = new IdbCatalogDriver();
