import type { Customer } from '@/types/database';

/** Variant row stored with catalog items (matches search API shape). */
export interface CatalogItemVariant {
  id: string;
  variant_name: string;
  attributes: Record<string, unknown>;
  selling_price?: number | null;
  current_stock: number;
  sku?: string;
  barcode?: string;
}

/** Item row for local catalog search (matches ItemAutocomplete / search API). */
export interface CatalogItemSearchResult {
  id: string;
  name: string;
  code?: string;
  barcode?: string;
  unit: string;
  item_type?: 'goods' | 'service';
  selling_price: number | null;
  purchase_price?: number;
  tax_rate: number;
  hsn_sac?: string;
  current_stock: number;
  image_url?: string;
  has_variants?: boolean;
  gst_included?: boolean;
  is_bundle?: boolean;
  variants?: CatalogItemVariant[];
  variantId?: string;
  variantName?: string;
  variantAttributes?: Record<string, unknown>;
}

export type CatalogCustomer = Pick<
  Customer,
  | 'id'
  | 'business_id'
  | 'name'
  | 'company_name'
  | 'phone'
  | 'email'
  | 'address'
  | 'billing_address'
  | 'shipping_address'
  | 'city'
  | 'state'
  | 'state_code'
  | 'pincode'
  | 'gstin'
  | 'opening_balance'
  | 'opening_balance_type'
  | 'credit_limit'
  | 'credit_days'
  | 'current_balance'
  | 'is_active'
  | 'created_at'
  | 'updated_at'
>;

export interface CatalogStockScope {
  warehouseId?: string | null;
  branchId?: string | null;
}

export interface CatalogSearchOptions extends CatalogStockScope {
  limit?: number;
}

export interface CatalogSyncProgress {
  phase: 'idle' | 'items' | 'customers' | 'invoices' | 'done' | 'error';
  itemsSynced: number;
  customersSynced: number;
  invoicesSynced?: number;
  totalItems?: number;
  totalCustomers?: number;
  message?: string;
}

export interface CatalogStatus {
  ready: boolean;
  itemCount: number;
  customerCount: number;
  lastFullSyncAt: number | null;
  lastItemsDeltaAt: number | null;
  lastCustomersDeltaAt: number | null;
  stockScope: CatalogStockScope;
  warning?: string;
}

export const CATALOG_SYNC_PAGE_SIZE = 500;
export const CATALOG_MAX_ITEMS = 20_000;
export const CATALOG_MAX_CUSTOMERS = 20_000;
