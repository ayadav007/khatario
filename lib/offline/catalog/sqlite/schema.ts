export const CATALOG_SQLITE_DB = 'khatario_catalog';

export const CATALOG_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS catalog_meta (
  scope_key TEXT NOT NULL,
  meta_key TEXT NOT NULL,
  meta_value TEXT NOT NULL,
  PRIMARY KEY (scope_key, meta_key)
);

CREATE TABLE IF NOT EXISTS catalog_items (
  row_id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  stock_scope_key TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  code TEXT,
  barcode TEXT,
  unit TEXT NOT NULL,
  item_type TEXT,
  selling_price REAL,
  purchase_price REAL,
  tax_rate REAL NOT NULL DEFAULT 0,
  hsn_sac TEXT,
  current_stock REAL NOT NULL DEFAULT 0,
  image_url TEXT,
  has_variants INTEGER NOT NULL DEFAULT 0,
  gst_included INTEGER NOT NULL DEFAULT 0,
  is_bundle INTEGER NOT NULL DEFAULT 0,
  variants_json TEXT,
  search_text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_items_tenant_scope
  ON catalog_items (business_id, user_id, stock_scope_key);

CREATE INDEX IF NOT EXISTS idx_catalog_items_search
  ON catalog_items (business_id, user_id, stock_scope_key, search_text);

CREATE TABLE IF NOT EXISTS catalog_customers (
  row_id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_customers_tenant
  ON catalog_customers (business_id, user_id);
`;

export function scopeKey(businessId: string, userId: string): string {
  return `${businessId}:${userId}`;
}
