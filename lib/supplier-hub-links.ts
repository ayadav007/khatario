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

export type Exec = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;

export function execFor(client?: PoolClient): Exec {
  return client ? (sql, params) => client.query(sql, params) : (sql, params) => db.query(sql, params);
}

export type CustomerMatchReason = 'gstin' | 'phone' | 'email';

export type CustomerMatch = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  city: string | null;
  reasons: CustomerMatchReason[];
};

export type BuyerLinkPreview = {
  buyer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    state: string | null;
    gstin: string | null;
    logo_url: string | null;
  };
  already_linked: { id: string; name: string } | null;
  matches: CustomerMatch[];
};

/** The supplier chose an existing customer, or a new one, before the link is saved. */
export type CustomerLinkChoice = { choice: 'link'; customerId: string } | { choice: 'create' };

export class CustomerLinkError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CustomerLinkError';
    this.status = status;
  }
}

function identityKeys(row: { gstin?: string | null; phone?: string | null; email?: string | null }) {
  const gstin = String(row.gstin || '').trim().toUpperCase();
  const digits = String(row.phone || '').replace(/\D/g, '').slice(-10);
  return {
    gstin,
    phone: digits.length === 10 ? digits : '',
    email: String(row.email || '').trim().toLowerCase(),
  };
}

/**
 * Customers on the supplier's books who are not yet linked, and who share the buyer's
 * GSTIN, phone, or email. Names are not compared.
 */
export async function previewVendorCustomerLink(
  vendorBusinessId: string,
  buyerBusinessId: string,
  client?: PoolClient
): Promise<BuyerLinkPreview> {
  const exec = execFor(client);
  const buyerRes = await exec(
    `SELECT id, name, email, phone, city, state, gstin, logo_url FROM businesses WHERE id = $1`,
    [buyerBusinessId]
  );
  const buyer = buyerRes.rows[0];
  if (!buyer) throw new CustomerLinkError('Buyer business not found', 400);

  const linked = await exec(
    `SELECT id, name FROM customers
      WHERE business_id = $1 AND linked_business_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [vendorBusinessId, buyerBusinessId]
  );

  const keys = identityKeys(buyer);
  const found = await exec(
    `SELECT id, name, phone, email, gstin, city,
            ($2 <> '' AND UPPER(TRIM(COALESCE(gstin, ''))) = $2) AS match_gstin,
            ($3 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $3) AS match_phone,
            ($4 <> '' AND LOWER(TRIM(COALESCE(email, ''))) = $4) AS match_email
       FROM customers
      WHERE business_id = $1
        AND deleted_at IS NULL
        AND linked_business_id IS NULL
        AND (
          ($2 <> '' AND UPPER(TRIM(COALESCE(gstin, ''))) = $2)
          OR ($3 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $3)
          OR ($4 <> '' AND LOWER(TRIM(COALESCE(email, ''))) = $4)
        )
      ORDER BY
        CASE
          WHEN $2 <> '' AND UPPER(TRIM(COALESCE(gstin, ''))) = $2 THEN 0
          WHEN $3 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $3 THEN 1
          ELSE 2
        END,
        name ASC
      LIMIT 20`,
    [vendorBusinessId, keys.gstin, keys.phone, keys.email]
  );

  return {
    buyer: {
      id: String(buyer.id),
      name: buyer.name || 'This shop',
      phone: buyer.phone || null,
      email: buyer.email || null,
      city: buyer.city || null,
      state: buyer.state || null,
      gstin: buyer.gstin || null,
      logo_url: buyer.logo_url || null,
    },
    already_linked: linked.rows[0]
      ? { id: String(linked.rows[0].id), name: linked.rows[0].name || 'Customer' }
      : null,
    matches: found.rows.map((row) => {
      const reasons: CustomerMatchReason[] = [];
      if (row.match_gstin) reasons.push('gstin');
      if (row.match_phone) reasons.push('phone');
      if (row.match_email) reasons.push('email');
      return {
        id: String(row.id),
        name: row.name || 'Customer',
        phone: row.phone || null,
        email: row.email || null,
        gstin: row.gstin || null,
        city: row.city || null,
        reasons,
      };
    }),
  };
}

async function insertBuyerAsCustomer(
  exec: Exec,
  vendorBusinessId: string,
  buyerBusinessId: string,
  buyer: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state?: string | null;
    state_code?: string | null;
    pincode?: string | null;
    gstin?: string | null;
  }
): Promise<string> {
  const gstin = String(buyer.gstin || '').trim().toUpperCase();
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
 * Make sure supplier B has a customer record linked to buyer A and return its id.
 *
 * A caller that passes `choice` has already asked the supplier: `link` attaches that
 * existing customer, `create` always inserts a new one. Without a choice, an existing
 * link is reused; otherwise the first unlinked customer with the same GSTIN, phone, or
 * email is attached, and a new customer is created only when nothing matches.
 */
export async function ensureVendorCustomerLink(
  vendorBusinessId: string,
  buyerBusinessId: string,
  client?: PoolClient,
  choice?: CustomerLinkChoice
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
  if (!buyer) throw new CustomerLinkError('Buyer business not found');

  if (choice?.choice === 'create') {
    return insertBuyerAsCustomer(exec, vendorBusinessId, buyerBusinessId, buyer);
  }

  if (choice?.choice === 'link') {
    const preview = await previewVendorCustomerLink(vendorBusinessId, buyerBusinessId, client);
    const match = preview.matches.find((row) => row.id === choice.customerId);
    if (!match) {
      throw new CustomerLinkError('That customer is not a match for this shop. Choose one of the matches, or create a new customer.');
    }
    await exec(
      `UPDATE customers SET linked_business_id = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $3 AND deleted_at IS NULL AND linked_business_id IS NULL`,
      [choice.customerId, buyerBusinessId, vendorBusinessId]
    );
    return choice.customerId;
  }

  const keys = identityKeys(buyer);
  const match = await exec(
    `SELECT id FROM customers
      WHERE business_id = $1
        AND deleted_at IS NULL
        AND linked_business_id IS NULL
        AND (
          ($2 <> '' AND UPPER(TRIM(COALESCE(gstin, ''))) = $2)
          OR ($3 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $3)
          OR ($4 <> '' AND LOWER(TRIM(COALESCE(email, ''))) = $4)
        )
      ORDER BY
        CASE
          WHEN $2 <> '' AND UPPER(TRIM(COALESCE(gstin, ''))) = $2 THEN 0
          WHEN $3 <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $3 THEN 1
          ELSE 2
        END,
        COALESCE(is_active, true) DESC,
        created_at ASC
      LIMIT 1`,
    [vendorBusinessId, keys.gstin, keys.phone, keys.email]
  );
  if (match.rows[0]) {
    const id = String(match.rows[0].id);
    await exec(
      `UPDATE customers SET linked_business_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id, buyerBusinessId]
    );
    return id;
  }

  return insertBuyerAsCustomer(exec, vendorBusinessId, buyerBusinessId, buyer);
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
  // Orders not yet billed stop; billed ones can still be received.
  await exec(
    `UPDATE supply_orders
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE buyer_business_id = $1 AND vendor_business_id = $2
        AND status IN ('awaiting_link', 'draft', 'proposed', 'pending', 'confirmed', 'partial')`,
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

/**
 * Open (or reuse) the buyer's pending hub connection request to a supplier and tell the
 * supplier. Every way of linking a supplier goes through this, so each request shows in the
 * supplier's Supplier Hub "Needs you" list and is accepted there. A share choice of true is
 * kept if the buyer asks again.
 */
export async function openConnectionRequest(params: {
  buyerBusinessId: string;
  supplierBusinessId: string;
  createdByUserId: string;
  message?: string | null;
  shareLowStock?: boolean;
  client?: PoolClient;
}): Promise<{ request: any; existing: boolean }> {
  const { buyerBusinessId, supplierBusinessId, createdByUserId, client } = params;
  const exec = execFor(client);
  const share = params.shareLowStock === true;

  const pending = (
    await exec(
      `SELECT * FROM supplier_connection_requests
        WHERE buyer_business_id = $1 AND supplier_business_id = $2 AND status = 'pending'`,
      [buyerBusinessId, supplierBusinessId]
    )
  ).rows[0];
  if (pending) {
    if (share && !pending.share_low_stock) {
      await exec(`UPDATE supplier_connection_requests SET share_low_stock = true WHERE id = $1`, [pending.id]);
      pending.share_low_stock = true;
    }
    return { request: pending, existing: true };
  }

  const request = (
    await exec(
      `INSERT INTO supplier_connection_requests (
         buyer_business_id, supplier_business_id, status, message, created_by_user_id, share_low_stock
       )
       VALUES ($1, $2, 'pending', $3, $4, $5)
       RETURNING *`,
      [buyerBusinessId, supplierBusinessId, params.message || null, createdByUserId, share]
    )
  ).rows[0];

  const buyer = await exec(`SELECT name FROM businesses WHERE id = $1`, [buyerBusinessId]);
  await exec(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'hub_connection_request', $2, $3, 'supplier_connection_request', $4, CURRENT_TIMESTAMP)`,
    [
      supplierBusinessId,
      'New supplier connection request',
      `${buyer.rows[0]?.name || 'A business'} wants to connect as a buyer. Open Supplier Hub to accept or decline.`,
      request.id,
    ]
  );
  const { queueHubWhatsApp } = await import('./supplier-hub-whatsapp');
  await queueHubWhatsApp(exec, supplierBusinessId, {
    title: `${buyer.rows[0]?.name || 'A business'} wants to buy from you`,
    detail: 'Accept the connection request so their orders and your bills flow through Supplier Hub.',
    path: '/suppliers/hub',
  });
  return { request, existing: false };
}

/** True when supplierId is one of businessId's own (not deleted) suppliers. */
export async function isOwnSupplier(businessId: string, supplierId: string): Promise<boolean> {
  const row = await db.queryOne(
    `SELECT 1 FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [supplierId, businessId]
  );
  return !!row;
}
