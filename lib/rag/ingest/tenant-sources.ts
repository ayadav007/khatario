import { queryOne, queryRows } from '@/lib/db';
import type { KbDocumentInput, KbSourceInput } from '../types';

export const TENANT_CATALOG_LOCATOR = 'catalog';
export const TENANT_POLICY_LOCATOR = 'policies';
/** Large catalogs: index the items most likely to be asked about, keep the indexing run bounded. */
export const TENANT_CATALOG_MAX_ITEMS = 2000;
const LOW_STOCK = 5;

export interface CatalogItemRow {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  selling_price: string | number | null;
  mrp: string | number | null;
  unit: string | null;
  current_stock: string | number | null;
  item_type: string | null;
  category: string | null;
  variants: Array<{ name: string; price: string | number | null; stock: string | number | null }> | null;
}

const num = (v: string | number | null | undefined) => (v == null || v === '' ? null : Number(v));
const rupees = (v: number) => `₹${Math.round(v * 100) / 100}`.replace(/\.0+$/, '');

/** Shoppers see a band, never the exact stock count. */
export function stockBand(stock: number | null, itemType: string | null): string | null {
  if (itemType === 'service') return null;
  if (stock == null) return null;
  if (stock <= 0) return 'Out of stock';
  if (stock <= LOW_STOCK) return 'Only a few left';
  return 'In stock';
}

export function catalogItemDocument(item: CatalogItemRow): KbDocumentInput {
  const price = num(item.selling_price);
  const mrp = num(item.mrp);
  const lines = [`# ${item.name}`];
  if (item.category) lines.push(`Category: ${item.category}`);
  if (item.code) lines.push(`Code: ${item.code}`);
  if (price != null) {
    const unit = item.unit ? ` per ${item.unit.toLowerCase()}` : '';
    lines.push(`Price: ${rupees(price)}${unit}${mrp != null && mrp > price ? ` (MRP ${rupees(mrp)})` : ''}`);
  }
  const band = stockBand(num(item.current_stock), item.item_type);
  if (band) lines.push(`Availability: ${band}`);
  if (item.item_type === 'service') lines.push('Type: service');
  for (const v of item.variants ?? []) {
    const vp = num(v.price);
    const vb = stockBand(num(v.stock), item.item_type);
    lines.push(`- Variant ${v.name}${vp != null ? `: ${rupees(vp)}` : ''}${vb ? ` (${vb})` : ''}`);
  }
  if (item.description?.trim()) lines.push('', item.description.trim().slice(0, 1500));
  return {
    docKey: `item:${item.id}`,
    title: item.name,
    url: null,
    audiences: ['tenant_customer'],
    locale: 'en',
    tags: ['catalog', ...(item.category ? [item.category.toLowerCase()] : [])],
    requiredFeature: null,
    body: lines.join('\n'),
  };
}

/**
 * Items listed in the online store. A shop that uses the WhatsApp bot without the online store has
 * nothing listed; then every active item is the catalog (what the bot used before).
 */
export async function loadTenantCatalogSource(businessId: string): Promise<KbSourceInput> {
  const listed = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM items WHERE business_id = $1 AND show_in_store = true AND deleted_at IS NULL LIMIT 1`,
    [businessId],
  );
  const items = await queryRows<CatalogItemRow>(
    `SELECT i.id, i.name, i.code, i.description, i.selling_price, i.mrp, i.unit, i.current_stock, i.item_type,
            c.name AS category,
            COALESCE(
              (SELECT json_agg(json_build_object('name', iv.variant_name, 'price', iv.selling_price, 'stock', iv.current_stock) ORDER BY iv.variant_name)
                 FROM item_variants iv WHERE iv.item_id = i.id),
              '[]'::json
            ) AS variants
       FROM items i
       LEFT JOIN categories c ON c.id = i.category_id
      WHERE i.business_id = $1
        AND ($3::boolean = false OR i.show_in_store = true)
        AND (i.is_active IS NULL OR i.is_active = true)
        AND i.deleted_at IS NULL
      ORDER BY i.updated_at DESC NULLS LAST, i.name
      LIMIT $2`,
    [businessId, TENANT_CATALOG_MAX_ITEMS, Boolean(listed)],
  );
  return {
    kind: 'tenant_catalog',
    locator: TENANT_CATALOG_LOCATOR,
    audiences: ['tenant_customer'],
    businessId,
    documents: items.map(catalogItemDocument),
  };
}

export interface PolicyRow {
  name: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  company_introduction: string | null;
  store_about_md: string | null;
  store_contact_md: string | null;
  store_refund_md: string | null;
  store_terms_md: string | null;
  store_min_order_amount: string | number | null;
  store_allow_cod: boolean | null;
}

export interface DeliveryRow {
  delivery_mode: string;
  delivery_radius_km: number | null;
  pincode_count: number;
  allow_pickup: boolean;
  location_address: string | null;
  charges: Array<{ min_km: number; max_km: number | null; charge: string | number; free_above: string | number | null }> | null;
}

export function deliveryMarkdown(policy: PolicyRow, zones: DeliveryRow[]): string | null {
  const lines: string[] = [];
  const minOrder = num(policy.store_min_order_amount);
  if (minOrder) lines.push(`Minimum order: ${rupees(minOrder)}.`);
  if (policy.store_allow_cod != null) lines.push(policy.store_allow_cod ? 'Cash on delivery is available.' : 'Cash on delivery is not available; pay online.');
  for (const z of zones) {
    const where = z.location_address ? ` from ${z.location_address}` : '';
    if (z.delivery_mode === 'all_india') lines.push(`We deliver across India${where}.`);
    else if (z.delivery_mode === 'pincode') lines.push(`We deliver to ${z.pincode_count} listed pincodes${where}. Share your pincode to check.`);
    else lines.push(`We deliver within ${z.delivery_radius_km ?? 10} km${where}.`);
    if (z.allow_pickup) lines.push('Store pickup is available.');
    for (const c of z.charges ?? []) {
      const range = c.max_km != null ? `${c.min_km}-${c.max_km} km` : `above ${c.min_km} km`;
      const free = num(c.free_above);
      lines.push(`- Delivery charge ${range}: ${rupees(Number(c.charge))}${free ? ` (free above ${rupees(free)})` : ''}`);
    }
  }
  return lines.length ? lines.join('\n') : null;
}

function policyDoc(key: string, title: string, body: string | null | undefined, tags: string[]): KbDocumentInput | null {
  const text = body?.trim();
  if (!text) return null;
  return { docKey: key, title, url: null, audiences: ['tenant_customer'], locale: 'en', tags, requiredFeature: null, body: `# ${title}\n\n${text.slice(0, 20_000)}` };
}

export function buildPolicyDocuments(policy: PolicyRow, zones: DeliveryRow[]): KbDocumentInput[] {
  const shop = policy.name?.trim() || 'Our shop';
  const contact = [
    policy.store_contact_md?.trim(),
    policy.phone ? `Phone / WhatsApp: ${policy.phone}` : null,
    policy.email ? `Email: ${policy.email}` : null,
    policy.address_line1 ? `Address: ${policy.address_line1}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    policyDoc('about', `About ${shop}`, [policy.company_introduction, policy.store_about_md].filter((s) => s?.trim()).join('\n\n'), ['about']),
    policyDoc('contact', `Contact ${shop}`, contact, ['contact']),
    policyDoc('refund', 'Returns and refunds', policy.store_refund_md, ['refund', 'return', 'policy']),
    policyDoc('terms', 'Terms', policy.store_terms_md, ['terms', 'policy']),
    policyDoc('delivery', 'Delivery and payment', deliveryMarkdown(policy, zones), ['delivery', 'shipping', 'cod']),
  ].filter((d): d is KbDocumentInput => d !== null);
}

export async function loadTenantPolicySource(businessId: string): Promise<KbSourceInput> {
  const [policy, zones] = await Promise.all([
    queryOne<PolicyRow>(
      `SELECT b.name, b.phone, b.email, b.address_line1, b.company_introduction,
              s.store_about_md, s.store_contact_md, s.store_refund_md, s.store_terms_md,
              s.store_min_order_amount, s.store_allow_cod
         FROM businesses b
         LEFT JOIN business_settings s ON s.business_id = b.id
        WHERE b.id = $1`,
      [businessId],
    ),
    queryRows<DeliveryRow>(
      `SELECT d.delivery_mode, d.delivery_radius_km, COALESCE(array_length(d.serviceable_pincodes, 1), 0) AS pincode_count,
              d.allow_pickup, d.location_address,
              (SELECT json_agg(json_build_object('min_km', c.min_distance_km, 'max_km', c.max_distance_km, 'charge', c.charge, 'free_above', c.free_above_amount) ORDER BY c.sort_order)
                 FROM store_delivery_charges c WHERE c.branch_delivery_id = d.id) AS charges
         FROM store_branch_delivery d
        WHERE d.business_id = $1 AND d.is_active = true
        LIMIT 5`,
      [businessId],
    ).catch(() => [] as DeliveryRow[]),
  ]);
  return {
    kind: 'tenant_policy',
    locator: TENANT_POLICY_LOCATOR,
    audiences: ['tenant_customer'],
    businessId,
    documents: policy ? buildPolicyDocuments(policy, zones) : [],
  };
}
