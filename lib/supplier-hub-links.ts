/**
 * Supplier Hub links, both sides.
 *
 * A link between buyer A and supplier B is two rows:
 *   - A's `suppliers` row with linked_business_id = B (approval_status tells whether it is live)
 *   - B's `customers` row with linked_business_id = A, so B finds A by link, not by name
 * Either side can disconnect. Past documents stay; hub access (requests, alerts, invoice
 * conversion) stops because every hub check requires approval_status = 'approved'.
 */

import type { PoolClient } from 'pg';
import * as db from './db';

type Exec = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;

function execFor(client?: PoolClient): Exec {
  return client ? (sql, params) => client.query(sql, params) : (sql, params) => db.query(sql, params);
}

/**
 * Make sure supplier B has a customer record linked to buyer A and return its id.
 * Reuses B's existing customer for A when it matches by GSTIN, then phone, then email;
 * otherwise creates one from A's business details.
 */
export async function ensureVendorCustomerLink(
  vendorBusinessId: string,
  buyerBusinessId: string,
  client?: PoolClient
): Promise<string> {
  const exec = execFor(client);

  const linked = await exec(
    `SELECT id FROM customers
      WHERE business_id = $1 AND linked_business_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [vendorBusinessId, buyerBusinessId]
  );
  if (linked.rows[0]) return String(linked.rows[0].id);

  const buyerRes = await exec(
    `SELECT name, email, phone, address_line1, address_line2, city, state, state_code, pincode, gstin
       FROM businesses WHERE id = $1`,
    [buyerBusinessId]
  );
  const buyer = buyerRes.rows[0];
  if (!buyer) throw new Error('Buyer business not found');

  const gstin = String(buyer.gstin || '').trim().toUpperCase();
  const phoneDigits = String(buyer.phone || '').replace(/\D/g, '').slice(-10);
  const email = String(buyer.email || '').trim().toLowerCase();

  const match = await exec(
    `SELECT id FROM customers
      WHERE business_id = $1
        AND deleted_at IS NULL
        AND linked_business_id IS NULL
        AND (
          ($2 <> '' AND UPPER(TRIM(gstin)) = $2)
          OR ($3 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $3)
          OR ($4 <> '' AND LOWER(TRIM(email)) = $4)
        )
      ORDER BY
        CASE
          WHEN $2 <> '' AND UPPER(TRIM(gstin)) = $2 THEN 0
          WHEN $3 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $3 THEN 1
          ELSE 2
        END,
        COALESCE(is_active, true) DESC,
        created_at ASC
      LIMIT 1`,
    [vendorBusinessId, gstin, phoneDigits.length === 10 ? phoneDigits : '', email]
  );
  if (match.rows[0]) {
    const id = String(match.rows[0].id);
    await exec(
      `UPDATE customers SET linked_business_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id, buyerBusinessId]
    );
    return id;
  }

  const address = [buyer.address_line1, buyer.address_line2].filter(Boolean).join(', ') || null;
  const created = await exec(
    `INSERT INTO customers (
       business_id, name, phone, email, address, city, state, state_code, pincode, gstin,
       linked_business_id, is_active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
     RETURNING id`,
    [
      vendorBusinessId,
      buyer.name || 'Customer',
      buyer.phone || null,
      buyer.email || null,
      address,
      buyer.city || null,
      buyer.state || null,
      buyer.state_code || (gstin ? gstin.slice(0, 2) : null),
      buyer.pincode || null,
      gstin || null,
      buyerBusinessId,
    ]
  );
  return String(created.rows[0].id);
}

/**
 * End the link between buyer A and supplier B. Either side may call it (actorBusinessId).
 * Returns false when there was no live or pending link to end.
 */
export async function disconnectSupplierLink(params: {
  buyerBusinessId: string;
  vendorBusinessId: string;
  actorBusinessId: string;
  client?: PoolClient;
}): Promise<boolean> {
  const { buyerBusinessId, vendorBusinessId, actorBusinessId, client } = params;
  const exec = execFor(client);

  const ended = await exec(
    `UPDATE suppliers
        SET approval_status = 'disconnected',
            allow_low_stock_access = false,
            disconnected_at = CURRENT_TIMESTAMP,
            disconnected_by_business_id = $3,
            updated_at = CURRENT_TIMESTAMP
      WHERE business_id = $1
        AND linked_business_id = $2
        AND approval_status IN ('approved', 'pending')
        AND deleted_at IS NULL`,
    [buyerBusinessId, vendorBusinessId, actorBusinessId]
  );
  if (!ended.rowCount) return false;

  await exec(
    `UPDATE low_stock_alerts
        SET alert_status = 'resolved', resolved_at = CURRENT_TIMESTAMP
      WHERE supplier_business_id = $2 AND customer_business_id = $1 AND alert_status = 'active'`,
    [buyerBusinessId, vendorBusinessId]
  );
  await exec(
    `UPDATE quantity_requests
        SET status = 'declined',
            notes = CONCAT_WS(E'\\n', NULLIF(notes, ''), 'Closed: supplier link disconnected'),
            updated_at = CURRENT_TIMESTAMP
      WHERE status = 'pending'
        AND (
          (requester_business_id = $1 AND responder_business_id = $2)
          OR (requester_business_id = $2 AND responder_business_id = $1)
        )`,
    [buyerBusinessId, vendorBusinessId]
  );
  await exec(
    `UPDATE supplier_connection_requests
        SET status = 'cancelled', resolved_at = CURRENT_TIMESTAMP
      WHERE buyer_business_id = $1 AND supplier_business_id = $2 AND status = 'pending'`,
    [buyerBusinessId, vendorBusinessId]
  );

  const otherId = actorBusinessId === buyerBusinessId ? vendorBusinessId : buyerBusinessId;
  const actor = await exec(`SELECT name FROM businesses WHERE id = $1`, [actorBusinessId]);
  const actorName = actor.rows[0]?.name || 'A business';
  await exec(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'general', 'Supplier link ended', $2, 'business', $3, CURRENT_TIMESTAMP)`,
    [
      otherId,
      `${actorName} disconnected from you in the Supplier Hub. Past bills stay; new requests, low-stock alerts and bill imports between you have stopped.`,
      actorBusinessId,
    ]
  );
  return true;
}

/** True when supplierId is one of businessId's own (not deleted) suppliers. */
export async function isOwnSupplier(businessId: string, supplierId: string): Promise<boolean> {
  const row = await db.queryOne(
    `SELECT 1 FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [supplierId, businessId]
  );
  return !!row;
}
