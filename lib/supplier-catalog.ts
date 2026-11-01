/**
 * Supplier Hub catalog (migration 394): collections and the new-arrival push.
 *
 * Publishing a collection the first time notifies every buyer with an approved link to the
 * supplier, once, unless that buyer muted the supplier's launches. Republishing an archived
 * collection does not notify again.
 */

import type { PoolClient } from 'pg';
import { execFor } from './supplier-hub-links';

export class CatalogInputError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CatalogInputError';
    this.status = status;
  }
}

/** Publish (or republish) a collection. Returns how many buyers were notified. */
export async function publishCollection(
  supplierBusinessId: string,
  collectionId: string,
  client?: PoolClient
): Promise<{ notified: number }> {
  const exec = execFor(client);
  const col = (
    await exec(
      `SELECT id, name, season, status, published_at FROM supplier_collections
        WHERE id = $1 AND supplier_business_id = $2 FOR UPDATE`,
      [collectionId, supplierBusinessId]
    )
  ).rows[0];
  if (!col) throw new CatalogInputError('Collection not found', 404);
  const count = Number(
    (
      await exec(
        `SELECT COUNT(*)::int AS n FROM supplier_published_listings
          WHERE collection_id = $1 AND supplier_business_id = $2 AND is_active = true`,
        [collectionId, supplierBusinessId]
      )
    ).rows[0].n
  );
  if (count === 0) throw new CatalogInputError('Add at least one item to the collection before publishing');

  const firstTime = !col.published_at;
  await exec(
    `UPDATE supplier_collections
        SET status = 'published', published_at = COALESCE(published_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [collectionId]
  );
  if (!firstTime) return { notified: 0 };

  const supplierName = (await exec(`SELECT name FROM businesses WHERE id = $1`, [supplierBusinessId])).rows[0]?.name || 'A supplier';
  const buyers = await exec(
    `SELECT DISTINCT s.business_id
       FROM suppliers s
      WHERE s.linked_business_id = $1
        AND s.approval_status = 'approved'
        AND s.deleted_at IS NULL
        AND s.mute_launches = false`,
    [supplierBusinessId]
  );
  const title = `${supplierName} launched ${col.name}`;
  const message = `${count} new item${count === 1 ? '' : 's'}${col.season ? ` for ${col.season}` : ''}. See them in New arrivals and order straight from there.`;
  for (const b of buyers.rows) {
    await exec(
      `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
       VALUES ($1, 'general', $2, $3, 'supplier_collection', $4, CURRENT_TIMESTAMP)`,
      [b.business_id, title, message, collectionId]
    );
  }
  return { notified: buyers.rows.length };
}

/** An uploaded photo (data URL) of about 600 KB; the catalogue screen scales photos down first. */
const PHOTO_MAX_CHARS = Math.ceil((600 * 1024 * 4) / 3) + 100;

export type ListingOption = { label: string; price: number | null };

/**
 * Sizes, colours or packs with their prices. Accepts a list of { label, price } or the short
 * form typed on the catalogue screen: "S:450, M:450, L:480" (a price is optional: "Red, Blue").
 * Undefined means "leave as is"; an empty list removes the options.
 */
export function parseListingOptions(raw: unknown): ListingOption[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return [];
  const parts: Array<{ label: unknown; price: unknown }> = Array.isArray(raw)
    ? raw.map((o: any) => ({ label: o?.label, price: o?.price }))
    : String(raw)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const i = p.lastIndexOf(':');
          return i > 0 ? { label: p.slice(0, i), price: p.slice(i + 1) } : { label: p, price: null };
        });
  if (parts.length > 40) throw new CatalogInputError('At most 40 options per item');
  const seen = new Set<string>();
  const out: ListingOption[] = [];
  for (const part of parts) {
    const label = String(part.label ?? '').trim().slice(0, 60);
    if (!label) throw new CatalogInputError('Each option needs a name, for example M or Red');
    if (seen.has(label.toLowerCase())) throw new CatalogInputError(`Option ${label} is listed twice`);
    seen.add(label.toLowerCase());
    const text = part.price == null ? '' : String(part.price).replace(/[₹,\s]/g, '');
    const price = text === '' ? null : Number(text);
    if (price != null && !(price >= 0)) throw new CatalogInputError(`Price for ${label} must be zero or more`);
    out.push({ label, price });
  }
  return out;
}

/** Replace a listing's options. */
export async function saveListingOptions(listingId: string, options: ListingOption[], client?: PoolClient) {
  const exec = execFor(client);
  await exec(`DELETE FROM supplier_listing_options WHERE listing_id = $1`, [listingId]);
  let sort = 0;
  for (const o of options) {
    await exec(`INSERT INTO supplier_listing_options (listing_id, label, price, sort_order) VALUES ($1, $2, $3, $4)`, [
      listingId,
      o.label,
      o.price,
      sort++,
    ]);
  }
}

/** SQL: a listing's options as JSON, given the listing alias `l`. */
export const LISTING_OPTIONS_SQL = `COALESCE((
  SELECT json_agg(json_build_object('id', o.id, 'label', o.label, 'price', o.price) ORDER BY o.sort_order)
    FROM supplier_listing_options o WHERE o.listing_id = l.id
), '[]'::json)`;

/** Listing fields a supplier may set, validated. Undefined means "leave as is". */
export function parseListingExtras(body: any, supplierBusinessId: string) {
  const out: {
    image_url?: string | null;
    price?: number | null;
    pack_label?: string | null;
    order_multiple?: number | null;
    collection_id?: string | null;
  } = {};
  if (body.image_url !== undefined) {
    const url = body.image_url ? String(body.image_url).trim() : '';
    const uploaded = /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url);
    if (url && !uploaded && !/^https:\/\//i.test(url) && !url.startsWith('/')) {
      throw new CatalogInputError('Photo must be an uploaded image or an https:// link');
    }
    if (uploaded && url.length > PHOTO_MAX_CHARS) throw new CatalogInputError('Photo is too large. Use an image under 600 KB.');
    out.image_url = url ? (uploaded ? url : url.slice(0, 2000)) : null;
  }
  if (body.price !== undefined) {
    const p = body.price === null || body.price === '' ? null : Number(body.price);
    if (p != null && !(p >= 0)) throw new CatalogInputError('Price must be zero or more');
    out.price = p;
  }
  if (body.pack_label !== undefined) out.pack_label = body.pack_label ? String(body.pack_label).trim().slice(0, 80) : null;
  if (body.order_multiple !== undefined) {
    const m = body.order_multiple === null || body.order_multiple === '' ? null : Number(body.order_multiple);
    if (m != null && !(m > 0)) throw new CatalogInputError('Order in multiples of must be more than zero');
    out.order_multiple = m;
  }
  if (body.collection_id !== undefined) out.collection_id = body.collection_id ? String(body.collection_id) : null;
  void supplierBusinessId;
  return out;
}

/** Throws unless the collection belongs to the supplier. */
export async function assertOwnCollection(supplierBusinessId: string, collectionId: string, client?: PoolClient) {
  const row = (
    await execFor(client)(`SELECT 1 FROM supplier_collections WHERE id = $1 AND supplier_business_id = $2`, [
      collectionId,
      supplierBusinessId,
    ])
  ).rows[0];
  if (!row) throw new CatalogInputError('Collection not found', 404);
}
