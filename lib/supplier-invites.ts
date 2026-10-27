/**
 * Orders to suppliers who are not on Khatario yet (migration 426).
 *
 * The buyer picks one of their own suppliers that has no linked business and sends an order
 * as a private link, usually from their own WhatsApp (wa.me with the message filled in). The
 * supplier opens /so/<token> without an account, confirms what they can send or declines, and
 * is invited to join. A business that opens the link signed in can connect: the buyer's
 * supplier record then links to it, exactly as an accepted hub request would. Both sides agreed:
 * the buyer by sending the order to that supplier, the supplier by connecting from the link.
 */

import { randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { execFor, ensureVendorCustomerLink } from './supplier-hub-links';
import { queueHubWhatsApp } from './supplier-hub-whatsapp';

export class InviteOrderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'InviteOrderError';
    this.status = status;
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function inviteOrderPath(token: string) {
  return `/so/${token}`;
}

async function notifyBuyer(exec: ReturnType<typeof execFor>, buyerId: string, title: string, message: string, supplierId: string) {
  await exec(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'general', $2, $3, 'supplier', $4, CURRENT_TIMESTAMP)`,
    [buyerId, title, message, supplierId]
  );
  await queueHubWhatsApp(exec, buyerId, { title, detail: message, path: `/suppliers/${supplierId}` });
}

/** Message the buyer sends with the link (they can edit it in WhatsApp). */
export function inviteOrderMessage(p: {
  buyerName: string;
  supplierName: string;
  lines: Array<{ item_name: string; qty: number; unit: string | null }>;
  link: string;
}) {
  const items = p.lines.map((l) => `• ${l.item_name}: ${l.qty} ${l.unit || ''}`.trim()).join('\n');
  return `Hello ${p.supplierName}, order from ${p.buyerName}:\n${items}\n\nPlease confirm what you can send here: ${p.link}`;
}

/** Create an order for one of the buyer's suppliers that is not on Khatario. */
export async function createInviteOrder(
  p: {
    buyerBusinessId: string;
    userId: string;
    supplierId: string;
    lines: Array<{ buyer_item_id?: string | null; item_name?: string | null; qty?: number | string | null }>;
    notes?: string | null;
    needBy?: string | null;
  },
  client?: PoolClient
) {
  const exec = execFor(client);
  const supplier = (
    await exec(
      `SELECT id, name, phone, linked_business_id, approval_status FROM suppliers
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [p.supplierId, p.buyerBusinessId]
    )
  ).rows[0];
  if (!supplier) throw new InviteOrderError('Supplier not found', 404);
  if (supplier.linked_business_id && supplier.approval_status === 'approved') {
    throw new InviteOrderError('This supplier is on Khatario. Order from them in Supplier Hub instead.', 409);
  }
  if (!Array.isArray(p.lines) || p.lines.length === 0) throw new InviteOrderError('Add at least one item');
  if (p.lines.length > 100) throw new InviteOrderError('At most 100 items per order');

  const lines: Array<{ buyerItemId: string | null; name: string; unit: string | null; qty: number }> = [];
  for (const raw of p.lines) {
    const qty = Number(raw.qty);
    let name = String(raw.item_name || '').trim();
    let unit: string | null = null;
    let buyerItemId: string | null = null;
    if (raw.buyer_item_id) {
      const item = (
        await exec(`SELECT id, name, unit FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`, [
          raw.buyer_item_id,
          p.buyerBusinessId,
        ])
      ).rows[0];
      if (!item) throw new InviteOrderError('An item on this order is not one of yours');
      buyerItemId = item.id;
      name = item.name;
      unit = item.unit || null;
    }
    if (!name) throw new InviteOrderError('Each line needs an item');
    if (!(qty > 0)) throw new InviteOrderError(`Quantity for ${name} must be more than zero`);
    lines.push({ buyerItemId, name: name.slice(0, 255), unit, qty: round3(qty) });
  }

  const token = randomBytes(24).toString('base64url');
  const order = (
    await exec(
      `INSERT INTO supplier_invite_orders (buyer_business_id, supplier_id, token, notes, need_by, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, token, status, created_at`,
      [p.buyerBusinessId, supplier.id, token, p.notes?.slice(0, 1000) || null, p.needBy || null, p.userId]
    )
  ).rows[0];
  let sort = 0;
  for (const l of lines) {
    await exec(
      `INSERT INTO supplier_invite_order_lines (invite_order_id, buyer_item_id, item_name, unit, qty, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [order.id, l.buyerItemId, l.name, l.unit, l.qty, sort++]
    );
  }
  const buyer = (await exec(`SELECT name FROM businesses WHERE id = $1`, [p.buyerBusinessId])).rows[0];
  return {
    order,
    supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone as string | null },
    message_lines: lines.map((l) => ({ item_name: l.name, qty: l.qty, unit: l.unit })),
    buyer_name: buyer?.name || 'Your customer',
  };
}

/** The buyer's orders to one supplier sent as links, newest first. */
export async function listInviteOrders(buyerBusinessId: string, supplierId: string) {
  const exec = execFor();
  return (
    await exec(
      `SELECT o.id, o.token, o.status, o.created_at, o.viewed_at, o.responded_at, o.response_note, o.joined_at,
              COALESCE(json_agg(json_build_object(
                'item_name', l.item_name, 'unit', l.unit, 'qty', l.qty, 'confirmed_qty', l.confirmed_qty
              ) ORDER BY l.sort_order) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
         FROM supplier_invite_orders o
         LEFT JOIN supplier_invite_order_lines l ON l.invite_order_id = o.id
        WHERE o.buyer_business_id = $1 AND o.supplier_id = $2
        GROUP BY o.id
        ORDER BY o.created_at DESC
        LIMIT 50`,
      [buyerBusinessId, supplierId]
    )
  ).rows;
}

/** Buyer withdraws an order link that has not been answered. */
export async function cancelInviteOrder(buyerBusinessId: string, orderId: string) {
  const res = await execFor()(
    `UPDATE supplier_invite_orders SET status = 'cancelled'
      WHERE id = $1 AND buyer_business_id = $2 AND status IN ('sent', 'viewed')`,
    [orderId, buyerBusinessId]
  );
  if (!res.rowCount) throw new InviteOrderError('This order can no longer be withdrawn', 409);
}

/**
 * What the supplier sees on the public page. Opening it the first time marks it viewed and
 * tells the buyer. Only the order itself and the buyer's name, place and phone are shown.
 */
export async function loadInviteForSupplier(token: string, opts: { markViewed?: boolean } = {}) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const exec = execFor();
  const order = (
    await exec(
      `SELECT o.id, o.status, o.notes, o.need_by, o.created_at, o.response_note, o.buyer_business_id, o.supplier_id,
              o.joined_business_id, b.name AS buyer_name, b.city AS buyer_city, b.phone AS buyer_phone,
              s.name AS supplier_name
         FROM supplier_invite_orders o
         JOIN businesses b ON b.id = o.buyer_business_id
         JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.token = $1`,
      [token]
    )
  ).rows[0];
  if (!order) return null;
  if (opts.markViewed && order.status === 'sent') {
    const marked = await exec(
      `UPDATE supplier_invite_orders SET status = 'viewed', viewed_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'sent'`,
      [order.id]
    );
    if (marked.rowCount) {
      order.status = 'viewed';
      await notifyBuyer(exec, order.buyer_business_id, `${order.supplier_name} opened your order`, 'They have the link and can confirm quantities there.', order.supplier_id);
    }
  }
  const lines = (
    await exec(
      `SELECT id, item_name, unit, qty, confirmed_qty FROM supplier_invite_order_lines
        WHERE invite_order_id = $1 ORDER BY sort_order`,
      [order.id]
    )
  ).rows.map((l: any) => ({
    id: l.id,
    item_name: l.item_name,
    unit: l.unit,
    qty: Number(l.qty),
    confirmed_qty: l.confirmed_qty == null ? null : Number(l.confirmed_qty),
  }));
  return {
    status: order.status as string,
    notes: order.notes as string | null,
    need_by: order.need_by as string | null,
    created_at: new Date(order.created_at).toISOString(),
    response_note: order.response_note as string | null,
    buyer: { name: order.buyer_name, city: order.buyer_city, phone: order.buyer_phone },
    supplier_name: order.supplier_name as string,
    joined: !!order.joined_business_id,
    lines,
    _internal: { id: order.id as string, buyerId: order.buyer_business_id as string, supplierId: order.supplier_id as string },
  };
}

/** Supplier answers from the public page: per-line quantities, or decline. Once only. */
export async function respondToInvite(
  token: string,
  p: { decline?: boolean; lines?: Array<{ id: string; confirmed_qty: number | string }>; note?: string | null }
) {
  const view = await loadInviteForSupplier(token);
  if (!view) throw new InviteOrderError('Order not found', 404);
  if (!['sent', 'viewed'].includes(view.status)) throw new InviteOrderError('This order has already been answered', 409);
  const exec = execFor();
  const note = p.note ? String(p.note).trim().slice(0, 500) : null;
  let next: 'declined' | 'confirmed' | 'partial' = 'declined';
  if (!p.decline) {
    const given = new Map((p.lines || []).map((l) => [String(l.id), Number(l.confirmed_qty)]));
    let full = 0;
    let none = 0;
    for (const l of view.lines) {
      const c = given.has(l.id) ? given.get(l.id)! : l.qty;
      if (!(c >= 0) || c > l.qty + 1e-9) throw new InviteOrderError(`Quantity for ${l.item_name} must be between 0 and ${l.qty}`);
      await exec(`UPDATE supplier_invite_order_lines SET confirmed_qty = $2 WHERE id = $1`, [l.id, round3(c)]);
      if (Math.abs(c - l.qty) < 1e-9) full++;
      if (c === 0) none++;
    }
    next = none === view.lines.length ? 'declined' : full === view.lines.length ? 'confirmed' : 'partial';
  }
  const res = await exec(
    `UPDATE supplier_invite_orders SET status = $2, response_note = $3, responded_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND status IN ('sent', 'viewed')`,
    [view._internal.id, next, note]
  );
  if (!res.rowCount) throw new InviteOrderError('This order has already been answered', 409);
  await notifyBuyer(
    exec,
    view._internal.buyerId,
    next === 'declined' ? `${view.supplier_name} cannot supply your order` : `${view.supplier_name} confirmed your order`,
    [next === 'partial' ? 'Some quantities are lower than you asked for.' : next === 'confirmed' ? 'All quantities confirmed.' : 'Nothing could be supplied.', note]
      .filter(Boolean)
      .join(' '),
    view._internal.supplierId
  );
  return next;
}

/**
 * A signed-in business connects from the link: the buyer's supplier record links to it as an
 * approved hub connection, and its customer record for the buyer is linked or created.
 */
export async function claimInvite(token: string, claimerBusinessId: string, client: PoolClient) {
  const exec = execFor(client);
  const order = (
    await exec(
      `SELECT o.id, o.buyer_business_id, o.supplier_id, o.joined_business_id,
              s.linked_business_id, s.approval_status, s.deleted_at
         FROM supplier_invite_orders o JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.token = $1
        FOR UPDATE OF o, s`,
      [token]
    )
  ).rows[0];
  if (!order) throw new InviteOrderError('Order not found', 404);
  if (order.buyer_business_id === claimerBusinessId) throw new InviteOrderError('This is your own order', 400);
  if (order.joined_business_id && order.joined_business_id !== claimerBusinessId) {
    throw new InviteOrderError('Another business already connected from this link', 409);
  }
  if (order.deleted_at) throw new InviteOrderError('The buyer removed this supplier', 409);
  if (order.linked_business_id && order.linked_business_id !== claimerBusinessId && order.approval_status === 'approved') {
    throw new InviteOrderError('The buyer is already connected to another business for this supplier', 409);
  }

  // The buyer may already have another supplier record linked to this business.
  const already = (
    await exec(
      `SELECT id FROM suppliers WHERE business_id = $1 AND linked_business_id = $2 AND approval_status = 'approved'
         AND deleted_at IS NULL AND id <> $3`,
      [order.buyer_business_id, claimerBusinessId, order.supplier_id]
    )
  ).rows[0];
  if (!already) {
    await exec(
      `UPDATE suppliers SET linked_business_id = $2, requested_by_business_id = business_id,
              approval_status = 'approved', approved_at = CURRENT_TIMESTAMP,
              disconnected_at = NULL, disconnected_by_business_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [order.supplier_id, claimerBusinessId]
    );
  }
  await ensureVendorCustomerLink(claimerBusinessId, order.buyer_business_id, client);
  await exec(
    `UPDATE supplier_invite_orders SET joined_business_id = $2, joined_at = COALESCE(joined_at, CURRENT_TIMESTAMP)
      WHERE buyer_business_id = $3 AND supplier_id = $1`,
    [order.supplier_id, claimerBusinessId, order.buyer_business_id]
  );
  const claimer = (await exec(`SELECT name FROM businesses WHERE id = $1`, [claimerBusinessId])).rows[0];
  await notifyBuyer(
    exec,
    order.buyer_business_id,
    `${claimer?.name || 'Your supplier'} joined Khatario and connected with you`,
    'Order from them in Supplier Hub now; their bills will come into your purchases.',
    order.supplier_id
  );
  return { supplierId: (already?.id as string) || (order.supplier_id as string), buyerBusinessId: order.buyer_business_id as string };
}
