import { normalizeBarcode } from '@/lib/barcode-validator';
import type {
  CatalogCustomer,
  CatalogItemSearchResult,
  CatalogItemVariant,
} from '@/lib/offline/catalog/types';

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

export function buildItemSearchText(item: CatalogItemSearchResult): string {
  const parts = [item.name, item.code, item.barcode]
    .filter(Boolean)
    .map((p) => normalizeSearchText(String(p)));
  if (item.variants?.length) {
    for (const v of item.variants) {
      if (v.variant_name) parts.push(normalizeSearchText(v.variant_name));
      if (v.sku) parts.push(normalizeSearchText(v.sku));
      if (v.barcode) parts.push(normalizeSearchText(v.barcode));
    }
  }
  return parts.join(' ');
}

export function buildCustomerSearchText(customer: CatalogCustomer): string {
  return [customer.name, customer.company_name, customer.phone, customer.gstin]
    .filter(Boolean)
    .map((p) => normalizeSearchText(String(p)))
    .join(' ');
}

function itemMatchesQuery(item: CatalogItemSearchResult, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return false;
  const normalizedBarcode = normalizeBarcode(query);
  if (item.barcode && normalizeBarcode(item.barcode) === normalizedBarcode) {
    return true;
  }
  if (item.name && normalizeSearchText(item.name).includes(q)) return true;
  if (item.code && normalizeSearchText(item.code).includes(q)) return true;
  if (item.barcode && normalizeSearchText(item.barcode).includes(q)) return true;
  if (item.variants?.length) {
    for (const v of item.variants) {
      if (v.barcode && normalizeBarcode(v.barcode) === normalizedBarcode) return true;
      if (v.barcode && normalizeSearchText(v.barcode).includes(q)) return true;
      if (v.variant_name && normalizeSearchText(v.variant_name).includes(q)) return true;
      if (v.sku && normalizeSearchText(v.sku).includes(q)) return true;
    }
  }
  return false;
}

function barcodeRank(item: CatalogItemSearchResult, query: string): number {
  const normalizedBarcode = normalizeBarcode(query);
  if (item.barcode && normalizeBarcode(item.barcode) === normalizedBarcode) return 1;
  if (item.variants?.some((v) => v.barcode && normalizeBarcode(v.barcode) === normalizedBarcode)) {
    return 2;
  }
  if (item.barcode && normalizeSearchText(item.barcode).includes(normalizeSearchText(query))) {
    return 3;
  }
  return 4;
}

export function searchCatalogItems(
  items: CatalogItemSearchResult[],
  query: string,
  limit = 50
): CatalogItemSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return items.slice(0, limit);
  return items
    .filter((item) => itemMatchesQuery(item, trimmed))
    .sort((a, b) => {
      const rankDiff = barcodeRank(a, trimmed) - barcodeRank(b, trimmed);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export function findItemByBarcode(
  items: CatalogItemSearchResult[],
  barcode: string
): { item: CatalogItemSearchResult; variant?: CatalogItemVariant } | null {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return null;
  for (const item of items) {
    if (item.barcode && normalizeBarcode(item.barcode) === normalized) {
      return { item };
    }
    const variant = item.variants?.find(
      (v) => v.barcode && normalizeBarcode(v.barcode) === normalized
    );
    if (variant) {
      return { item, variant };
    }
  }
  return null;
}

export function searchCatalogCustomers(
  customers: CatalogCustomer[],
  query: string,
  limit = 20
): CatalogCustomer[] {
  const q = normalizeSearchText(query);
  if (!q || q.length < 2) return customers.slice(0, limit);
  return customers
    .filter((c) => {
      const text = buildCustomerSearchText(c);
      return text.includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function mapApiItemToCatalog(raw: Record<string, unknown>): CatalogItemSearchResult {
  const variants = Array.isArray(raw.variants)
    ? (raw.variants as CatalogItemVariant[])
    : undefined;
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    code: raw.code != null ? String(raw.code) : undefined,
    barcode: raw.barcode != null ? String(raw.barcode) : undefined,
    unit: String(raw.unit ?? 'PCS'),
    item_type: raw.item_type as CatalogItemSearchResult['item_type'],
    selling_price:
      raw.selling_price === null || raw.selling_price === undefined
        ? null
        : Number(raw.selling_price),
    purchase_price:
      raw.purchase_price != null ? Number(raw.purchase_price) : undefined,
    tax_rate: Number(raw.tax_rate ?? 0),
    hsn_sac: raw.hsn_sac != null ? String(raw.hsn_sac) : undefined,
    current_stock: Number(raw.current_stock ?? 0),
    image_url: raw.image_url != null ? String(raw.image_url) : undefined,
    has_variants: Boolean(raw.has_variants),
    gst_included: Boolean(raw.gst_included),
    is_bundle: Boolean(raw.is_bundle),
    variants,
  };
}

export function mapApiCustomerToCatalog(raw: Record<string, unknown>): CatalogCustomer {
  return raw as unknown as CatalogCustomer;
}
