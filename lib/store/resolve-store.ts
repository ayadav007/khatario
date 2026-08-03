import { queryOne, queryRows } from '@/lib/db';

export interface StoreBusinessContext {
  business_id: string;
  name: string;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  store_subdomain: string;
  store_tagline: string | null;
  store_hero_image_url: string | null;
  store_min_order_amount: number;
  portal_theme: Record<string, unknown> | null;
}

export interface StoreBranch {
  id: string;
  name: string;
  location_lat: number | null;
  location_lng: number | null;
  location_address: string | null;
  delivery_mode: 'radius' | 'pincode' | 'all_india';
  delivery_radius_km: number;
  serviceable_pincodes: string[];
  allow_pickup: boolean;
}

export interface StoreDeliveryCharge {
  min_distance_km: number;
  max_distance_km: number | null;
  charge: number;
  free_above_amount: number | null;
}

const RESERVED_SUBDOMAINS = new Set([
  'www', 'staging', 'app', 'api', 'admin', 'mail', 'smtp',
  'ftp', 'cdn', 'assets', 'static', 'status', 'help', 'support',
  'docs', 'blog', 'dev', 'test', 'demo', 'sandbox', 'ns1', 'ns2',
  'mx', 'pop', 'imap', 'webmail', 'cpanel', 'whm', 'ftp',
]);

export function isReservedStoreSubdomain(subdomain: string): boolean {
  return RESERVED_SUBDOMAINS.has(subdomain.toLowerCase());
}

export function isValidStoreSubdomain(subdomain: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(subdomain);
}

export async function resolveStoreBySubdomain(
  subdomain: string,
): Promise<StoreBusinessContext | null> {
  const row = await queryOne<{
    business_id: string;
    name: string;
    logo_url: string | null;
    phone: string | null;
    email: string | null;
    store_subdomain: string;
    store_tagline: string | null;
    store_hero_image_url: string | null;
    store_min_order_amount: string | null;
    portal_theme: unknown;
  }>(
    `SELECT
       b.id AS business_id, b.name, b.logo_url, b.phone, b.email,
       bs.store_subdomain, bs.store_tagline, bs.store_hero_image_url,
       bs.store_min_order_amount::text,
       bs.portal_theme
     FROM businesses b
     INNER JOIN business_settings bs ON bs.business_id = b.id
     WHERE lower(trim(bs.store_subdomain)) = $1
       AND bs.store_enabled = true`,
    [subdomain.toLowerCase().trim()],
  );

  if (!row) return null;

  return {
    business_id: row.business_id,
    name: row.name,
    logo_url: row.logo_url,
    phone: row.phone,
    email: row.email,
    store_subdomain: row.store_subdomain,
    store_tagline: row.store_tagline,
    store_hero_image_url: row.store_hero_image_url,
    store_min_order_amount: parseFloat(row.store_min_order_amount ?? '0') || 0,
    portal_theme: (row.portal_theme as Record<string, unknown>) ?? null,
  };
}

export async function getStoreBranches(businessId: string): Promise<StoreBranch[]> {
  const rows = await queryRows<{
    id: string;
    name: string;
    location_lat: string | null;
    location_lng: string | null;
    location_address: string | null;
    delivery_mode: string;
    delivery_radius_km: number;
    serviceable_pincodes: string[];
    allow_pickup: boolean;
  }>(
    `SELECT
       br.id, br.name,
       sbd.location_lat::text, sbd.location_lng::text, sbd.location_address,
       sbd.delivery_mode, sbd.delivery_radius_km,
       sbd.serviceable_pincodes, sbd.allow_pickup
     FROM branches br
     INNER JOIN store_branch_delivery sbd
       ON sbd.branch_id = br.id AND sbd.business_id = br.business_id
     WHERE br.business_id = $1
       AND br.is_active = true
       AND sbd.is_active = true
     ORDER BY br.name`,
    [businessId],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    location_lat: r.location_lat ? parseFloat(r.location_lat) : null,
    location_lng: r.location_lng ? parseFloat(r.location_lng) : null,
    location_address: r.location_address,
    delivery_mode: r.delivery_mode as StoreBranch['delivery_mode'],
    delivery_radius_km: r.delivery_radius_km,
    serviceable_pincodes: r.serviceable_pincodes ?? [],
    allow_pickup: r.allow_pickup,
  }));
}

export async function getStoreDeliveryCharges(
  branchDeliveryId: string,
): Promise<StoreDeliveryCharge[]> {
  const rows = await queryRows<{
    min_distance_km: number;
    max_distance_km: number | null;
    charge: string;
    free_above_amount: string | null;
  }>(
    `SELECT min_distance_km, max_distance_km, charge::text, free_above_amount::text
     FROM store_delivery_charges
     WHERE branch_delivery_id = $1
     ORDER BY sort_order`,
    [branchDeliveryId],
  );

  return rows.map((r) => ({
    min_distance_km: r.min_distance_km,
    max_distance_km: r.max_distance_km,
    charge: parseFloat(r.charge) || 0,
    free_above_amount: r.free_above_amount ? parseFloat(r.free_above_amount) : null,
  }));
}
