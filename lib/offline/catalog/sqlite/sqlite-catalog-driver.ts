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
  buildCustomerSearchText,
  buildItemSearchText,
  searchCatalogCustomers,
  searchCatalogItems,
} from '@/lib/offline/catalog/search-helpers';
import {
  customerRowId,
  itemRowId,
  stockScopeKey,
} from '@/lib/offline/catalog/idb/idb-catalog-db';
import {
  CATALOG_SQLITE_DB,
  CATALOG_SQLITE_SCHEMA,
  scopeKey,
} from '@/lib/offline/catalog/sqlite/schema';

type SqlRow = Record<string, unknown>;

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
        await CapacitorSQLite.execute({
          database: CATALOG_SQLITE_DB,
          statements: CATALOG_SQLITE_SCHEMA,
        });
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
  const result = await CapacitorSQLite.query({
    database: CATALOG_SQLITE_DB,
    statement:
      'SELECT meta_value FROM catalog_meta WHERE scope_key = ? AND meta_key = ?',
    values: [sk, key],
  });
  const row = result.values?.[0] as SqlRow | undefined;
  if (!row) return null;
  return String(row.meta_value ?? row['meta_value'] ?? '');
}

async function writeMeta(sk: string, key: string, value: string): Promise<void> {
  await CapacitorSQLite.run({
    database: CATALOG_SQLITE_DB,
    statement: `INSERT INTO catalog_meta (scope_key, meta_key, meta_value)
      VALUES (?, ?, ?)
      ON CONFLICT(scope_key, meta_key) DO UPDATE SET meta_value = excluded.meta_value`,
    values: [sk, key, value],
  });
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
    const scopeKeyVal = stockScopeKey(stockScope);
    const now = new Date().toISOString();
    for (const item of items) {
      await CapacitorSQLite.run({
        database: CATALOG_SQLITE_DB,
        statement: `INSERT INTO catalog_items (
          row_id, business_id, user_id, item_id, stock_scope_key,
          name, code, barcode, unit, item_type, selling_price, purchase_price,
          tax_rate, hsn_sac, current_stock, image_url, has_variants, gst_included,
          is_bundle, variants_json, search_text, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(row_id) DO UPDATE SET
          name = excluded.name,
          code = excluded.code,
          barcode = excluded.barcode,
          unit = excluded.unit,
          item_type = excluded.item_type,
          selling_price = excluded.selling_price,
          purchase_price = excluded.purchase_price,
          tax_rate = excluded.tax_rate,
          hsn_sac = excluded.hsn_sac,
          current_stock = excluded.current_stock,
          image_url = excluded.image_url,
          has_variants = excluded.has_variants,
          gst_included = excluded.gst_included,
          is_bundle = excluded.is_bundle,
          variants_json = excluded.variants_json,
          search_text = excluded.search_text,
          updated_at = excluded.updated_at`,
        values: [
          itemRowId(scope.businessId, scope.userId, item.id, scopeKeyVal),
          scope.businessId,
          scope.userId,
          item.id,
          scopeKeyVal,
          item.name,
          item.code ?? null,
          item.barcode ?? null,
          item.unit,
          item.item_type ?? null,
          item.selling_price,
          item.purchase_price ?? null,
          item.tax_rate,
          item.hsn_sac ?? null,
          item.current_stock,
          item.image_url ?? null,
          item.has_variants ? 1 : 0,
          item.gst_included ? 1 : 0,
          item.is_bundle ? 1 : 0,
          item.variants?.length ? JSON.stringify(item.variants) : null,
          buildItemSearchText(item),
          now,
        ],
      });
    }
    await writeMeta(sk, 'stockScope', JSON.stringify(stockScope));
  }

  async upsertCustomers(scope: TenantScope, customers: CatalogCustomer[]): Promise<void> {
    await this.ready();
    const now = new Date().toISOString();
    for (const customer of customers) {
      await CapacitorSQLite.run({
        database: CATALOG_SQLITE_DB,
        statement: `INSERT INTO catalog_customers (
          row_id, business_id, user_id, customer_id, payload_json, search_text, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(row_id) DO UPDATE SET
          payload_json = excluded.payload_json,
          search_text = excluded.search_text,
          updated_at = excluded.updated_at`,
        values: [
          customerRowId(scope.businessId, scope.userId, customer.id),
          scope.businessId,
          scope.userId,
          customer.id,
          JSON.stringify(customer),
          buildCustomerSearchText(customer),
          now,
        ],
      });
    }
  }

  private async loadItems(
    scope: TenantScope,
    scopeKeyVal: string
  ): Promise<CatalogItemSearchResult[]> {
    await this.ready();
    const result = await CapacitorSQLite.query({
      database: CATALOG_SQLITE_DB,
      statement: `SELECT * FROM catalog_items
        WHERE business_id = ? AND user_id = ? AND stock_scope_key = ?
        ORDER BY name ASC`,
      values: [scope.businessId, scope.userId, scopeKeyVal],
    });
    return (result.values ?? []).map((row) => rowToItem(row as SqlRow));
  }

  async searchItems(
    scope: TenantScope,
    query: string,
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
    return searchCatalogItems(items, query, options?.limit ?? 50);
  }

  async browseItems(
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
    return items.slice(0, options?.limit ?? 120);
  }

  async findItemByBarcode(
    scope: TenantScope,
    barcode: string,
    options?: CatalogStockScope
  ): Promise<CatalogItemSearchResult | null> {
    const items = await this.searchItems(scope, barcode, { ...options, limit: 5 });
    return items[0] ?? null;
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
    const result = await CapacitorSQLite.query({
      database: CATALOG_SQLITE_DB,
      statement: `SELECT payload_json FROM catalog_customers
        WHERE business_id = ? AND user_id = ?
        ORDER BY search_text ASC
        LIMIT ?`,
      values: [scope.businessId, scope.userId, limit],
    });
    return (result.values ?? []).map((row) => {
      const payload = (row as SqlRow).payload_json as string;
      return JSON.parse(payload) as CatalogCustomer;
    });
  }

  async getStatus(scope: TenantScope): Promise<CatalogStatus> {
    await this.ready();
    const sk = scopeKey(scope.businessId, scope.userId);
    const itemCountResult = await CapacitorSQLite.query({
      database: CATALOG_SQLITE_DB,
      statement:
        'SELECT COUNT(*) as cnt FROM catalog_items WHERE business_id = ? AND user_id = ?',
      values: [scope.businessId, scope.userId],
    });
    const customerCountResult = await CapacitorSQLite.query({
      database: CATALOG_SQLITE_DB,
      statement:
        'SELECT COUNT(*) as cnt FROM catalog_customers WHERE business_id = ? AND user_id = ?',
      values: [scope.businessId, scope.userId],
    });
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
    return {
      ready: itemCount > 0 || customerCount > 0,
      itemCount,
      customerCount,
      lastFullSyncAt: await parseMeta('lastFullSyncAt'),
      lastItemsDeltaAt: await parseMeta('lastItemsDeltaAt'),
      lastCustomersDeltaAt: await parseMeta('lastCustomersDeltaAt'),
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
  }

  async clearTenant(scope: TenantScope): Promise<void> {
    await this.ready();
    const sk = scopeKey(scope.businessId, scope.userId);
    await CapacitorSQLite.run({
      database: CATALOG_SQLITE_DB,
      statement: 'DELETE FROM catalog_items WHERE business_id = ? AND user_id = ?',
      values: [scope.businessId, scope.userId],
    });
    await CapacitorSQLite.run({
      database: CATALOG_SQLITE_DB,
      statement: 'DELETE FROM catalog_customers WHERE business_id = ? AND user_id = ?',
      values: [scope.businessId, scope.userId],
    });
    await CapacitorSQLite.run({
      database: CATALOG_SQLITE_DB,
      statement: 'DELETE FROM catalog_meta WHERE scope_key = ?',
      values: [sk],
    });
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
