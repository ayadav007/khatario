import { CapacitorSQLite } from '@capacitor-community/sqlite';
import type { CatalogCustomer, CatalogItemSearchResult, CatalogStockScope } from '@/lib/offline/catalog/types';
import type { TenantScope } from '@/lib/offline/types';
import {
  buildCustomerSearchText,
  buildItemSearchText,
} from '@/lib/offline/catalog/search-helpers';
import {
  customerRowId,
  itemRowId,
  stockScopeKey,
} from '@/lib/offline/catalog/idb/idb-catalog-db';
import { CATALOG_SQLITE_DB } from '@/lib/offline/catalog/sqlite/schema';
import {
  recordCatalogUpsertMetrics,
  tracedSqliteExecuteSet,
} from '@/lib/debug/sqlite-probe';

/** Statements per native executeSet bridge call (500-item page → 5 calls). */
export const UPSERT_EXECUTE_SET_BATCH_SIZE = 100;

const ITEM_UPSERT_SQL = `INSERT INTO catalog_items (
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
  updated_at = excluded.updated_at`;

const CUSTOMER_UPSERT_SQL = `INSERT INTO catalog_customers (
  row_id, business_id, user_id, customer_id, payload_json, search_text, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(row_id) DO UPDATE SET
  payload_json = excluded.payload_json,
  search_text = excluded.search_text,
  updated_at = excluded.updated_at`;

type SqliteSetEntry = { statement: string; values: (string | number | null)[] };

function chunkSet<T>(entries: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < entries.length; i += size) {
    chunks.push(entries.slice(i, i + size));
  }
  return chunks;
}

async function executeSetInBatches(
  label: string,
  set: SqliteSetEntry[]
): Promise<{ bridgeCalls: number; durationMs: number }> {
  if (set.length === 0) return { bridgeCalls: 0, durationMs: 0 };

  const started = Date.now();
  let bridgeCalls = 0;

  for (const chunk of chunkSet(set, UPSERT_EXECUTE_SET_BATCH_SIZE)) {
    await tracedSqliteExecuteSet(`${label}/batch`, chunk.length, () =>
      CapacitorSQLite.executeSet({
        database: CATALOG_SQLITE_DB,
        set: chunk,
        transaction: true,
      })
    );
    bridgeCalls += 1;
  }

  return { bridgeCalls, durationMs: Date.now() - started };
}

function buildItemSetEntry(
  scope: TenantScope,
  item: CatalogItemSearchResult,
  scopeKeyVal: string,
  now: string
): SqliteSetEntry {
  return {
    statement: ITEM_UPSERT_SQL,
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
  };
}

function buildCustomerSetEntry(
  scope: TenantScope,
  customer: CatalogCustomer,
  now: string
): SqliteSetEntry {
  return {
    statement: CUSTOMER_UPSERT_SQL,
    values: [
      customerRowId(scope.businessId, scope.userId, customer.id),
      scope.businessId,
      scope.userId,
      customer.id,
      JSON.stringify(customer),
      buildCustomerSearchText(customer),
      now,
    ],
  };
}

export async function batchUpsertCatalogItems(
  scope: TenantScope,
  items: CatalogItemSearchResult[],
  stockScope: CatalogStockScope
): Promise<void> {
  if (items.length === 0) return;

  const scopeKeyVal = stockScopeKey(stockScope);
  const now = new Date().toISOString();
  const set = items.map((item) => buildItemSetEntry(scope, item, scopeKeyVal, now));
  const { bridgeCalls, durationMs } = await executeSetInBatches('upsertItems', set);

  recordCatalogUpsertMetrics({
    kind: 'items',
    rows: items.length,
    bridgeCalls,
    durationMs,
    priorBridgeCallsEstimate: items.length,
  });
}

export async function batchUpsertCatalogCustomers(
  scope: TenantScope,
  customers: CatalogCustomer[]
): Promise<void> {
  if (customers.length === 0) return;

  const now = new Date().toISOString();
  const set = customers.map((customer) => buildCustomerSetEntry(scope, customer, now));
  const { bridgeCalls, durationMs } = await executeSetInBatches('upsertCustomers', set);

  recordCatalogUpsertMetrics({
    kind: 'customers',
    rows: customers.length,
    bridgeCalls,
    durationMs,
    priorBridgeCallsEstimate: customers.length,
  });
}
