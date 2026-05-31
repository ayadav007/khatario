import { CapacitorSQLite } from '@capacitor-community/sqlite';
import { isCapacitorNative } from '@/lib/capacitor/platform';
import type { CatalogRepository } from '@/lib/offline/catalog/catalog-repository';
import type { TenantScope } from '@/lib/offline/types';
import type {
  CatalogCustomer,
  CatalogItemSearchResult,
  CatalogSearchOptions,
  CatalogStatus,
  CatalogStockScope,
} from '@/lib/offline/catalog/types';
import {
  searchCatalogCustomers,
  searchCatalogItems,
} from '@/lib/offline/catalog/search-helpers';
import {
  stockScopeKey,
} from '@/lib/offline/catalog/idb/idb-catalog-db';
import {
  CATALOG_SQLITE_DB,
  CATALOG_SQLITE_SCHEMA,
  scopeKey,
} from '@/lib/offline/catalog/sqlite/schema';
import {
  resolveSqliteLabel,
  tracedSqliteExecute,
  tracedSqliteQuery,
  tracedSqliteRun,
} from '@/lib/debug/sqlite-probe';
import {
  batchUpsertCatalogCustomers,
  batchUpsertCatalogItems,
} from '@/lib/offline/catalog/sqlite/sqlite-batch-upsert';

type SqlRow = Record<string, unknown>;

const STATUS_CACHE_TTL_MS = 5_000;
const statusCache = new Map<
  string,
  { at: number; status: CatalogStatus }
>();

function invalidateStatusCache(scope: TenantScope): void {
  statusCache.delete(scopeKey(scope.businessId, scope.userId));
}

async function sqliteQuery(
  method: string,
  statement: string,
  values?: unknown[]
): Promise<Awaited<ReturnType<typeof CapacitorSQLite.query>>> {
  const label = resolveSqliteLabel(method);
  return tracedSqliteQuery(label, statement, () =>
    CapacitorSQLite.query({
      database: CATALOG_SQLITE_DB,
      statement,
      values: values as (string | number | null)[] | undefined,
    })
  );
}

async function sqliteRun(
  method: string,
  statement: string,
  values?: unknown[]
): Promise<void> {
  const label = resolveSqliteLabel(method);
  await tracedSqliteRun(label, statement, () =>
    CapacitorSQLite.run({
      database: CATALOG_SQLITE_DB,
      statement,
      values: values as (string | number | null)[] | undefined,
    })
  );
}

let schemaReady = false;
let connectionReady = false;
let initFailed = false;
let initPromise: Promise<boolean> | null = null;

function isAlreadyConnectedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists|already open|duplicate/i.test(msg);
}

async function ensureSqliteReady(): Promise<boolean> {
  if (!isCapacitorNative() || typeof window === 'undefined') return false;
  if (initFailed) return false;
  if (connectionReady && schemaReady) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (!connectionReady) {
        try {
          await CapacitorSQLite.createConnection({
            database: CATALOG_SQLITE_DB,
            version: 1,
            encrypted: false,
          });
        } catch (err) {
          if (!isAlreadyConnectedError(err)) throw err;
        }
        await CapacitorSQLite.open({ database: CATALOG_SQLITE_DB });
        connectionReady = true;
      }
      if (!schemaReady) {
        await tracedSqliteExecute('init/schema', CATALOG_SQLITE_SCHEMA, () =>
          CapacitorSQLite.execute({
            database: CATALOG_SQLITE_DB,
            statements: CATALOG_SQLITE_SCHEMA,
          })
        );
        schemaReady = true;
      }
      return true;
    } catch (err) {
      initFailed = true;
      connectionReady = false;
      schemaReady = false;
      console.warn('[CatalogSQLite] init failed, falling back to IndexedDB', err);
      return false;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

async function readMeta(sk: string, key: string): Promise<string | null> {
  const result = await sqliteQuery(
    'readMeta',
    'SELECT meta_value FROM catalog_meta WHERE scope_key = ? AND meta_key = ?',
    [sk, key]
  );
  const row = result.values?.[0] as SqlRow | undefined;
  if (!row) return null;
  return String(row.meta_value ?? row['meta_value'] ?? '');
}

async function writeMeta(sk: string, key: string, value: string): Promise<void> {
  await sqliteRun(
    'writeMeta',
    `INSERT INTO catalog_meta (scope_key, meta_key, meta_value)
      VALUES (?, ?, ?)
      ON CONFLICT(scope_key, meta_key) DO UPDATE SET meta_value = excluded.meta_value`,
    [sk, key, value]
  );
}

function rowToItem(row: SqlRow): CatalogItemSearchResult {
  const variantsJson = row.variants_json as string | null | undefined;
  return {
    id: String(row.item_id),
    name: String(row.name),
    code: row.code != null ? String(row.code) : undefined,
    barcode: row.barcode != null ? String(row.barcode) : undefined,
    unit: String(row.unit ?? 'PCS'),
    item_type: row.item_type as CatalogItemSearchResult['item_type'],
    selling_price:
      row.selling_price === null || row.selling_price === undefined
        ? null
        : Number(row.selling_price),
    purchase_price:
      row.purchase_price != null ? Number(row.purchase_price) : undefined,
    tax_rate: Number(row.tax_rate ?? 0),
    hsn_sac: row.hsn_sac != null ? String(row.hsn_sac) : undefined,
    current_stock: Number(row.current_stock ?? 0),
    image_url: row.image_url != null ? String(row.image_url) : undefined,
    has_variants: Boolean(row.has_variants),
    gst_included: Boolean(row.gst_included),
    is_bundle: Boolean(row.is_bundle),
    variants: variantsJson
      ? (JSON.parse(variantsJson) as CatalogItemSearchResult['variants'])
      : undefined,
  };
}

export class SqliteCatalogDriver implements CatalogRepository {
  private async ready(): Promise<void> {
    const ok = await ensureSqliteReady();
    if (!ok) throw new Error('SQLite catalog unavailable');
  }

  async upsertItems(
    scope: TenantScope,
    items: CatalogItemSearchResult[],
    stockScope: CatalogStockScope
  ): Promise<void> {
    await this.ready();
    const sk = scopeKey(scope.businessId, scope.userId);
    await batchUpsertCatalogItems(scope, items, stockScope);
    await writeMeta(sk, 'stockScope', JSON.stringify(stockScope));
    invalidateStatusCache(scope);
  }

  async upsertCustomers(scope: TenantScope, customers: CatalogCustomer[]): Promise<void> {
    await this.ready();
    await batchUpsertCatalogCustomers(scope, customers);
    invalidateStatusCache(scope);
  }

  private async loadItems(
    scope: TenantScope,
    scopeKeyVal: string
  ): Promise<CatalogItemSearchResult[]> {
    await this.ready();
    const result = await sqliteQuery(
      'loadItems',
      `SELECT * FROM catalog_items
        WHERE business_id = ? AND user_id = ? AND stock_scope_key = ?
        ORDER BY name ASC`,
      [scope.businessId, scope.userId, scopeKeyVal]
    );
    return (result.values ?? []).map((row) => rowToItem(row as SqlRow));
  }

  /** All cached items for tenant, deduped by item id (multiple stock scopes). */
  private async loadAllItemsForTenant(scope: TenantScope): Promise<CatalogItemSearchResult[]> {
    await this.ready();
    const result = await sqliteQuery(
      'loadAllItemsForTenant',
      `SELECT * FROM catalog_items
        WHERE business_id = ? AND user_id = ?
        ORDER BY name ASC`,
      [scope.businessId, scope.userId]
    );
    const byId = new Map<string, CatalogItemSearchResult>();
    for (const row of result.values ?? []) {
      const item = rowToItem(row as SqlRow);
      byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }

  /**
   * Resolve items for list/search: requested scope → default → last sync scope → all rows.
   * Sync often stores under wh:/br: keys while list pages read with scope "default".
   */
  private async resolveBrowsableItems(
    scope: TenantScope,
    options?: CatalogSearchOptions
  ): Promise<CatalogItemSearchResult[]> {
    const scopeKeyVal = stockScopeKey({
      warehouseId: options?.warehouseId,
      branchId: options?.branchId,
    });
    let items = await this.loadItems(scope, scopeKeyVal);
    if (items.length === 0 && scopeKeyVal !== 'default') {
      items = await this.loadItems(scope, 'default');
    }
    if (items.length === 0) {
      const sk = scopeKey(scope.businessId, scope.userId);
      const stockScopeRaw = await readMeta(sk, 'stockScope');
      if (stockScopeRaw) {
        try {
          const parsed = JSON.parse(stockScopeRaw) as CatalogStockScope;
          const metaKey = stockScopeKey(parsed);
          if (metaKey !== scopeKeyVal && metaKey !== 'default') {
            items = await this.loadItems(scope, metaKey);
          }
        } catch {
          /* ignore bad meta */
        }
      }
    }
    if (items.length === 0) {
      items = await this.loadAllItemsForTenant(scope);
    }
    return items;
  }

  async searchItems(
    scope: TenantScope,
    query: string,
    options?: CatalogSearchOptions
  ): Promise<CatalogItemSearchResult[]> {
    const items = await this.resolveBrowsableItems(scope, options);
    return searchCatalogItems(items, query, options?.limit ?? 50);
  }

  async browseItems(
    scope: TenantScope,
    options?: CatalogSearchOptions
  ): Promise<CatalogItemSearchResult[]> {
    const items = await this.resolveBrowsableItems(scope, options);
    return items.slice(0, options?.limit ?? 120);
  }

  async findItemByBarcode(
    scope: TenantScope,
    barcode: string,
    options?: CatalogStockScope
  ): Promise<CatalogItemSearchResult | null> {
    const items = await this.resolveBrowsableItems(scope, options);
    const normalized = barcode.trim().toLowerCase();
    const exact = items.find(
      (it) => it.barcode && it.barcode.trim().toLowerCase() === normalized
    );
    if (exact) return exact;
    if (items.some((it) => it.variants?.length)) {
      for (const it of items) {
        const variant = it.variants?.find(
          (v) => v.barcode && v.barcode.trim().toLowerCase() === normalized
        );
        if (variant) return { ...it, ...variant, id: it.id };
      }
    }
    return null;
  }

  async searchCustomers(
    scope: TenantScope,
    query: string,
    limit = 20
  ): Promise<CatalogCustomer[]> {
    const customers = await this.listCustomers(scope, 10_000);
    return searchCatalogCustomers(customers, query, limit);
  }

  async listCustomers(scope: TenantScope, limit = 20): Promise<CatalogCustomer[]> {
    await this.ready();
    const result = await sqliteQuery(
      'listCustomers',
      `SELECT payload_json FROM catalog_customers
        WHERE business_id = ? AND user_id = ?
        ORDER BY search_text ASC
        LIMIT ?`,
      [scope.businessId, scope.userId, limit]
    );
    return (result.values ?? []).map((row) => {
      const payload = (row as SqlRow).payload_json as string;
      return JSON.parse(payload) as CatalogCustomer;
    });
  }

  async getStatus(scope: TenantScope): Promise<CatalogStatus> {
    await this.ready();
    const sk = scopeKey(scope.businessId, scope.userId);
    const cached = statusCache.get(sk);
    if (cached && Date.now() - cached.at < STATUS_CACHE_TTL_MS) {
      return cached.status;
    }

    const itemCountResult = await sqliteQuery(
      'getStatus/itemCount',
      'SELECT COUNT(*) as cnt FROM catalog_items WHERE business_id = ? AND user_id = ?',
      [scope.businessId, scope.userId]
    );
    const customerCountResult = await sqliteQuery(
      'getStatus/customerCount',
      'SELECT COUNT(*) as cnt FROM catalog_customers WHERE business_id = ? AND user_id = ?',
      [scope.businessId, scope.userId]
    );
    const itemCount = Number((itemCountResult.values?.[0] as SqlRow)?.cnt ?? 0);
    const customerCount = Number(
      (customerCountResult.values?.[0] as SqlRow)?.cnt ?? 0
    );
    const stockScopeRaw = await readMeta(sk, 'stockScope');
    let stockScope: CatalogStockScope = {};
    if (stockScopeRaw) {
      try {
        stockScope = JSON.parse(stockScopeRaw) as CatalogStockScope;
      } catch {
        stockScope = {};
      }
    }
    const parseMeta = async (key: string) => {
      const raw = await readMeta(sk, key);
      return raw ? Number(raw) : null;
    };
    const status: CatalogStatus = {
      ready: itemCount > 0 || customerCount > 0,
      itemCount,
      customerCount,
      lastFullSyncAt: await parseMeta('lastFullSyncAt'),
      lastItemsDeltaAt: await parseMeta('lastItemsDeltaAt'),
      lastCustomersDeltaAt: await parseMeta('lastCustomersDeltaAt'),
      stockScope,
    };
    statusCache.set(sk, { at: Date.now(), status });
    return status;
  }

  async setSyncTimestamps(
    scope: TenantScope,
    patch: {
      lastFullSyncAt?: number;
      lastItemsDeltaAt?: number;
      lastCustomersDeltaAt?: number;
    }
  ): Promise<void> {
    await this.ready();
    const sk = scopeKey(scope.businessId, scope.userId);
    if (patch.lastFullSyncAt != null) {
      await writeMeta(sk, 'lastFullSyncAt', String(patch.lastFullSyncAt));
    }
    if (patch.lastItemsDeltaAt != null) {
      await writeMeta(sk, 'lastItemsDeltaAt', String(patch.lastItemsDeltaAt));
    }
    if (patch.lastCustomersDeltaAt != null) {
      await writeMeta(sk, 'lastCustomersDeltaAt', String(patch.lastCustomersDeltaAt));
    }
    invalidateStatusCache(scope);
  }

  async clearTenant(scope: TenantScope): Promise<void> {
    await this.ready();
    const sk = scopeKey(scope.businessId, scope.userId);
    await sqliteRun(
      'clearTenant/items',
      'DELETE FROM catalog_items WHERE business_id = ? AND user_id = ?',
      [scope.businessId, scope.userId]
    );
    await sqliteRun(
      'clearTenant/customers',
      'DELETE FROM catalog_customers WHERE business_id = ? AND user_id = ?',
      [scope.businessId, scope.userId]
    );
    await sqliteRun(
      'clearTenant/meta',
      'DELETE FROM catalog_meta WHERE scope_key = ?',
      [sk]
    );
    invalidateStatusCache(scope);
  }
}

export const sqliteCatalogDriver = new SqliteCatalogDriver();

export async function isSqliteCatalogAvailable(): Promise<boolean> {
  return ensureSqliteReady();
}

export function resetSqliteCatalogInit(): void {
  schemaReady = false;
  connectionReady = false;
  initFailed = false;
  initPromise = null;
}

export function isSqliteCatalogInitFailed(): boolean {
  return initFailed;
}
