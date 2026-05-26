import type { CatalogCustomer, CatalogItemSearchResult } from '@/lib/offline/catalog/types';
import type { Customer, Item } from '@/types/database';

const NOW = new Date();

export function catalogItemToListItem(
  row: CatalogItemSearchResult,
  businessId: string
): Item {
  return {
    id: row.id,
    business_id: businessId,
    name: row.name,
    code: row.code,
    barcode: row.barcode,
    unit: row.unit,
    hsn_sac: row.hsn_sac,
    item_type: row.item_type,
    purchase_price: row.purchase_price ?? 0,
    selling_price: row.selling_price,
    tax_rate: row.tax_rate,
    opening_stock: row.current_stock,
    current_stock: row.current_stock,
    min_stock: 0,
    image_url: row.image_url,
    has_variants: row.has_variants,
    is_bundle: row.is_bundle,
    is_active: true,
    created_at: NOW,
    updated_at: NOW,
  };
}

export function catalogCustomerToListCustomer(row: CatalogCustomer): Customer {
  return {
    ...row,
    is_active: row.is_active !== false,
  } as Customer;
}
