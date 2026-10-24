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
    if (url && !/^https:\/\//i.test(url) && !url.startsWith('/')) {
      throw new CatalogInputError('Photo must be an https:// link or an uploaded file path');
    }
    out.image_url = url ? url.slice(0, 2000) : null;
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
