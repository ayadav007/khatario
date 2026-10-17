/**
 * Supplier Hub orders (migration 393): multi-line orders between a buyer and a connected supplier.
 *
 *   supplier side: draft -> proposed -> (buyer) confirmed
 *   buyer side:    pending -> (supplier) confirmed | partial | declined
 *   then:          invoiced -> received; cancelled any time before invoicing
 *
 * Line quantities are in the supplier's unit (qty, confirmed_qty); buyer_units_per_vendor_unit
 * converts them to the buyer's unit. Suggested drafts are built from the buyer's own reorder
 * levels for items whose default supplier is the connected supplier and who share low stock.
 */

import type { PoolClient } from 'pg';
import { execFor, type Exec } from './supplier-hub-links';
import { saveItemLink } from './supplier-item-links';

export class SupplyOrderInputError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = 'SupplyOrderInputError';
    this.status = status;
    this.code = code;
  }
}

export type SupplyOrderStatus =
  | 'draft'
  | 'proposed'
  | 'pending'
  | 'confirmed'
  | 'partial'
  | 'declined'
  | 'invoiced'
  | 'received'
  | 'cancelled';

export const OPEN_STATUSES: SupplyOrderStatus[] = ['draft', 'proposed', 'pending', 'confirmed', 'partial', 'invoiced'];

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** How many of the buyer's units to order for an item at or below its reorder level. */
export function suggestedBuyerQty(item: {
  current_stock: unknown;
  min_stock: unknown;
  reorder_qty?: unknown;
  max_stock?: unknown;
}): number {
  const current = Math.max(0, Number(item.current_stock) || 0);
  const min = Number(item.min_stock) || 0;
  const reorder = Number(item.reorder_qty) || 0;
  const max = Number(item.max_stock) || 0;
  let qty: number;
  if (max > 0) qty = max - current;
  else if (reorder > 0) qty = reorder;
  else qty = Math.max(min * 2 - current, min);
  return Math.max(1, round3(qty));
}

/** Supplier units needed to cover a quantity in the buyer's units (whole cartons when factor > 1). */
export function vendorQtyFor(buyerQty: number, factor: number): number {
  const f = factor > 0 ? factor : 1;
  return f > 1 ? Math.max(1, Math.ceil(buyerQty / f - 1e-9)) : round3(buyerQty);
}

async function approvedLink(exec: Exec, buyerBusinessId: string, vendorBusinessId: string) {
  const res = await exec(
    `SELECT id, allow_low_stock_access FROM suppliers
      WHERE business_id = $1 AND linked_business_id = $2
        AND approval_status = 'approved' AND deleted_at IS NULL
      LIMIT 1`,
    [buyerBusinessId, vendorBusinessId]
  );
  return res.rows[0] as { id: string; allow_low_stock_access: boolean } | undefined;
}

async function bestLinkForBuyerItem(exec: Exec, buyer: string, vendor: string, buyerItemId: string) {
  const res = await exec(
    `SELECT vendor_item_id, buyer_units_per_vendor_unit AS factor
       FROM supplier_item_links
      WHERE buyer_business_id = $1 AND vendor_business_id = $2 AND buyer_item_id = $3
      ORDER BY (source = 'manual') DESC, last_used_at DESC NULLS LAST
      LIMIT 1`,
    [buyer, vendor, buyerItemId]
  );
  const r = res.rows[0];
  return r ? { vendorItemId: String(r.vendor_item_id), factor: Number(r.factor) || 1 } : null;
}

async function bestLinkForVendorItem(exec: Exec, buyer: string, vendor: string, vendorItemId: string) {
  const res = await exec(
    `SELECT buyer_item_id, buyer_units_per_vendor_unit AS factor
       FROM supplier_item_links
      WHERE buyer_business_id = $1 AND vendor_business_id = $2 AND vendor_item_id = $3
      LIMIT 1`,
    [buyer, vendor, vendorItemId]
  );
  const r = res.rows[0];
  return r ? { buyerItemId: String(r.buyer_item_id), factor: Number(r.factor) || 1 } : null;
}

async function notify(exec: Exec, businessId: string, title: string, message: string, orderId: string) {
  await exec(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'general', $2, $3, 'supply_order', $4, CURRENT_TIMESTAMP)`,
    [businessId, title, message, orderId]
  );
}

async function businessName(exec: Exec, id: string) {
  return (await exec(`SELECT name FROM businesses WHERE id = $1`, [id])).rows[0]?.name || 'A business';
}

/**
 * Build or top up one suggested draft per connected buyer–supplier pair from the buyer's items
 * at or below their reorder level, skipping items already on an open order. The supplier is
 * notified once per pair when lines are added. Returns the number of lines added.
 */
export async function buildSuggestedOrders(
  scope: { vendorBusinessId?: string; buyerBusinessId?: string } = {},
  client?: PoolClient
): Promise<{ orders: number; lines: number }> {
  const exec = execFor(client);
  const args: any[] = [];
  const where: string[] = [];
  if (scope.vendorBusinessId) {
    args.push(scope.vendorBusinessId);
    where.push(`s.linked_business_id = $${args.length}`);
  }
  if (scope.buyerBusinessId) {
    args.push(scope.buyerBusinessId);
    where.push(`i.business_id = $${args.length}`);
  }
  const candidates = await exec(
    `
    SELECT i.id AS item_id, i.name, i.business_id AS buyer_id, s.linked_business_id AS vendor_id,
           i.current_stock, i.min_stock, i.reorder_qty, i.max_stock
    FROM items i
    JOIN suppliers s
      ON s.id = i.default_supplier_id AND s.business_id = i.business_id
     AND s.approval_status = 'approved' AND s.allow_low_stock_access = true
     AND s.linked_business_id IS NOT NULL AND s.deleted_at IS NULL
    WHERE i.deleted_at IS NULL
      AND COALESCE(i.is_active, true) = true
      AND COALESCE(i.item_type, 'goods') <> 'service'
      AND COALESCE(i.has_variants, false) = false
      AND COALESCE(i.min_stock, 0) > 0
      AND COALESCE(i.current_stock, 0) <= i.min_stock
      AND NOT EXISTS (
        SELECT 1 FROM supply_order_lines l
        JOIN supply_orders o ON o.id = l.order_id
        WHERE l.buyer_item_id = i.id
          AND o.buyer_business_id = i.business_id
          AND o.vendor_business_id = s.linked_business_id
          AND o.status IN ('draft', 'proposed', 'pending', 'confirmed', 'partial', 'invoiced')
      )
      ${where.length ? `AND ${where.join(' AND ')}` : ''}
    ORDER BY i.business_id, s.linked_business_id, i.name
    `,
    args
  );

  const byPair = new Map<string, any[]>();
  for (const c of candidates.rows) {
    const key = `${c.buyer_id}|${c.vendor_id}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push(c);
  }

  let orders = 0;
  let lines = 0;
  for (const [key, items] of byPair) {
    const [buyer, vendor] = key.split('|');
    await exec(
      `INSERT INTO supply_orders (buyer_business_id, vendor_business_id, status, origin, created_by_business_id)
       VALUES ($1, $2, 'draft', 'suggested', $2)
       ON CONFLICT (buyer_business_id, vendor_business_id) WHERE status = 'draft' AND origin = 'suggested'
       DO NOTHING`,
      [buyer, vendor]
    );
    const order = (
      await exec(
        `SELECT id FROM supply_orders
          WHERE buyer_business_id = $1 AND vendor_business_id = $2 AND status = 'draft' AND origin = 'suggested'`,
        [buyer, vendor]
      )
    ).rows[0];
    let sort = Number(
      (await exec(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM supply_order_lines WHERE order_id = $1`, [order.id]))
        .rows[0].n
    );
    for (const it of items) {
      const link = await bestLinkForBuyerItem(exec, buyer, vendor, it.item_id);
      const factor = link?.factor ?? 1;
      await exec(
        `INSERT INTO supply_order_lines (
           order_id, buyer_item_id, vendor_item_id, item_name, qty, buyer_units_per_vendor_unit,
           buyer_stock_at_suggestion, sort_order
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          order.id,
          it.item_id,
          link?.vendorItemId ?? null,
          it.name,
          vendorQtyFor(suggestedBuyerQty(it), factor),
          factor,
          Number(it.current_stock) || 0,
          sort++,
        ]
      );
      lines++;
    }
    await exec(`UPDATE supply_orders SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [order.id]);
    orders++;
    await notify(
      exec,
      vendor,
      `Suggested order for ${await businessName(exec, buyer)}`,
      `${items.length} item${items.length === 1 ? ' is' : 's are'} at or below their reorder level. Review the quantities and send the order for confirmation.`,
      order.id
    );
  }
  return { orders, lines };
}

export type NewLine = {
  buyer_item_id?: string | null;
  vendor_item_id?: string | null;
  /** Supplier units */
  qty?: number | string | null;
  /** Buyer units; converted with the item map when qty is not given */
  buyer_qty?: number | string | null;
};

/** Validate and normalise lines for a new order between buyer and vendor. */
async function prepareLines(exec: Exec, buyer: string, vendor: string, raw: NewLine[], catalogOnly: boolean) {
  if (!Array.isArray(raw) || raw.length === 0) throw new SupplyOrderInputError('Add at least one item');
  if (raw.length > 200) throw new SupplyOrderInputError('At most 200 lines per order');
  const out: Array<{ buyerItemId: string | null; vendorItemId: string | null; name: string; qty: number; factor: number }> = [];
  for (const line of raw) {
    let buyerItemId = line.buyer_item_id ? String(line.buyer_item_id) : null;
    let vendorItemId = line.vendor_item_id ? String(line.vendor_item_id) : null;
    let factor = 1;
    let name = '';
    if (buyerItemId) {
      const own = (
        await exec(
          `SELECT name FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
             AND COALESCE(item_type, 'goods') <> 'service'`,
          [buyerItemId, buyer]
        )
      ).rows[0];
      if (!own) throw new SupplyOrderInputError("An item on this order is not one of the buyer's items");
      name = own.name;
      if (!vendorItemId) {
        const link = await bestLinkForBuyerItem(exec, buyer, vendor, buyerItemId);
        if (link) {
          vendorItemId = link.vendorItemId;
          factor = link.factor;
        }
      }
    }
    if (vendorItemId) {
      const theirs = (
        await exec(
          `SELECT i.name, l.display_name, l.is_active AS listed
             FROM items i
             LEFT JOIN supplier_published_listings l ON l.item_id = i.id AND l.supplier_business_id = i.business_id
            WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL`,
          [vendorItemId, vendor]
        )
      ).rows[0];
      if (!theirs) throw new SupplyOrderInputError("An item on this order is not one of the supplier's items");
      if (catalogOnly && !buyerItemId && !theirs.listed) {
        throw new SupplyOrderInputError('Only items from the supplier’s published catalog can be ordered directly');
      }
      if (!buyerItemId) {
        const link = await bestLinkForVendorItem(exec, buyer, vendor, vendorItemId);
        if (link) {
          buyerItemId = link.buyerItemId;
          factor = link.factor;
        }
      }
      if (!name) name = theirs.display_name || theirs.name;
    }
    if (!buyerItemId && !vendorItemId) throw new SupplyOrderInputError('Each line needs an item');

    const qty =
      line.qty != null && line.qty !== ''
        ? Number(line.qty)
        : line.buyer_qty != null && line.buyer_qty !== ''
          ? vendorQtyFor(Number(line.buyer_qty), factor)
          : NaN;
    if (!(qty > 0)) throw new SupplyOrderInputError(`Quantity for ${name} must be more than zero`);
    out.push({ buyerItemId, vendorItemId, name: name.slice(0, 255), qty: round3(qty), factor });
  }
  return out;
}

/**
 * Create an order. As buyer it goes straight to the supplier (pending). As supplier it starts
 * as a draft, or is sent to the buyer at once with send = true (proposed).
 */
export async function createSupplyOrder(
  p: {
    actorBusinessId: string;
    userId: string;
    role: 'buyer' | 'vendor';
    counterpartyBusinessId: string;
    lines: NewLine[];
    needBy?: string | null;
    notes?: string | null;
    send?: boolean;
    origin?: 'buyer' | 'vendor' | 'catalog';
  },
  client?: PoolClient
): Promise<{ id: string; status: SupplyOrderStatus }> {
  const exec = execFor(client);
  const buyer = p.role === 'buyer' ? p.actorBusinessId : p.counterpartyBusinessId;
  const vendor = p.role === 'buyer' ? p.counterpartyBusinessId : p.actorBusinessId;
  if (buyer === vendor) throw new SupplyOrderInputError('Choose another business');
  if (!(await approvedLink(exec, buyer, vendor))) {
    throw new SupplyOrderInputError('You are not connected with this business', 403, 'NOT_LINKED');
  }
  const lines = await prepareLines(exec, buyer, vendor, p.lines, p.origin === 'catalog');
  const status: SupplyOrderStatus = p.role === 'buyer' ? 'pending' : p.send ? 'proposed' : 'draft';
  const origin = p.origin ?? (p.role === 'buyer' ? 'buyer' : 'vendor');

  const order = (
    await exec(
      `INSERT INTO supply_orders (
         buyer_business_id, vendor_business_id, status, origin, need_by, notes,
         created_by_business_id, created_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, status`,
      [buyer, vendor, status, origin, p.needBy || null, p.notes?.slice(0, 1000) || null, p.actorBusinessId, p.userId]
    )
  ).rows[0];
  let sort = 0;
  for (const l of lines) {
    await exec(
      `INSERT INTO supply_order_lines (order_id, buyer_item_id, vendor_item_id, item_name, qty, buyer_units_per_vendor_unit, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [order.id, l.buyerItemId, l.vendorItemId, l.name, l.qty, l.factor, sort++]
    );
  }
  if (status === 'pending') {
    await notify(exec, vendor, `New order from ${await businessName(exec, buyer)}`, `${lines.length} item${lines.length === 1 ? '' : 's'}. Confirm the quantities you can supply.`, order.id);
  } else if (status === 'proposed') {
    await notify(exec, buyer, `Order proposed by ${await businessName(exec, vendor)}`, `${lines.length} item${lines.length === 1 ? '' : 's'}. Check the quantities and confirm.`, order.id);
  }
  return { id: order.id, status: order.status };
}

export type OrderWithRole = {
  order: any;
  role: 'buyer' | 'vendor';
};

/** Load an order for one of its two businesses (locks the row inside a transaction). */
export async function loadOrderForParty(
  orderId: string,
  businessId: string,
  client?: PoolClient,
  lock = false
): Promise<OrderWithRole> {
  const exec = execFor(client);
  const order = (
    await exec(`SELECT * FROM supply_orders WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [orderId])
  ).rows[0];
  if (!order || (order.buyer_business_id !== businessId && order.vendor_business_id !== businessId)) {
    throw new SupplyOrderInputError('Order not found', 404);
  }
  return { order, role: order.buyer_business_id === businessId ? 'buyer' : 'vendor' };
}

export type LineEdit = {
  id: string;
  qty?: number | string | null;
  confirmed_qty?: number | string | null;
  vendor_item_id?: string | null;
  remove?: boolean;
};

/**
 * Move an order along. Actions:
 *   update  — supplier edits a draft (qty, supplier item, remove lines)
 *   send    — supplier sends a draft to the buyer (proposed)
 *   confirm — buyer agrees a proposed order, optionally changing quantities
 *   respond — supplier answers a pending order with the quantity it can supply per line
 *   decline — the side that has to answer turns it down
 *   cancel  — either side, before it is invoiced
 */
export async function transitionSupplyOrder(
  p: { orderId: string; actorBusinessId: string; userId: string; action: string; lines?: LineEdit[]; note?: string | null },
  client: PoolClient
): Promise<SupplyOrderStatus> {
  const exec = execFor(client);
  const { order, role } = await loadOrderForParty(p.orderId, p.actorBusinessId, client, true);
  // A supplier's draft is invisible to the buyer until it is sent.
  if (role === 'buyer' && order.status === 'draft') throw new SupplyOrderInputError('Order not found', 404);
  const buyer = order.buyer_business_id as string;
  const vendor = order.vendor_business_id as string;
  const status = order.status as SupplyOrderStatus;
  const other = role === 'buyer' ? vendor : buyer;
  const actorName = await businessName(exec, p.actorBusinessId);
  const edits = new Map((p.lines || []).map((l) => [String(l.id), l]));
  const lines = (await exec(`SELECT * FROM supply_order_lines WHERE order_id = $1 ORDER BY sort_order`, [order.id])).rows;
  for (const id of edits.keys()) {
    if (!lines.some((l: any) => l.id === id)) throw new SupplyOrderInputError('A line is not on this order');
  }
  const need = (ok: boolean, msg: string) => {
    if (!ok) throw new SupplyOrderInputError(msg, 409, 'INVALID_STATE');
  };
  const setStatus = async (next: SupplyOrderStatus, extra = '') => {
    await exec(`UPDATE supply_orders SET status = $2, updated_at = CURRENT_TIMESTAMP ${extra} WHERE id = $1`, [order.id, next]);
  };

  /** Apply supplier-item choices (and learn the match) for a supplier acting on lines. */
  const applyVendorItems = async () => {
    for (const l of lines) {
      const e = edits.get(l.id);
      if (!e?.vendor_item_id || e.vendor_item_id === l.vendor_item_id) continue;
      const own = (
        await exec(`SELECT 1 FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`, [e.vendor_item_id, vendor])
      ).rows[0];
      if (!own) throw new SupplyOrderInputError('Pick one of your own items');
      await exec(`UPDATE supply_order_lines SET vendor_item_id = $2 WHERE id = $1`, [l.id, e.vendor_item_id]);
      l.vendor_item_id = e.vendor_item_id;
      if (l.buyer_item_id) {
        await saveItemLink(
          { buyerBusinessId: buyer, vendorBusinessId: vendor, buyerItemId: l.buyer_item_id, vendorItemId: e.vendor_item_id, source: 'request', userId: p.userId },
          client
        );
      }
    }
  };

  /** Apply quantity edits / removals (qty in supplier units). */
  const applyQtyEdits = async () => {
    for (const l of lines) {
      const e = edits.get(l.id);
      if (!e) continue;
      if (e.remove) {
        await exec(`DELETE FROM supply_order_lines WHERE id = $1`, [l.id]);
        l._removed = true;
        continue;
      }
      if (e.qty != null && e.qty !== '') {
        const q = Number(e.qty);
        if (!(q > 0)) throw new SupplyOrderInputError(`Quantity for ${l.item_name} must be more than zero`);
        await exec(`UPDATE supply_order_lines SET qty = $2 WHERE id = $1`, [l.id, round3(q)]);
        l.qty = round3(q);
      }
    }
    if (lines.every((l: any) => l._removed)) throw new SupplyOrderInputError('An order needs at least one item');
  };

  switch (p.action) {
    case 'update': {
      need(role === 'vendor' && status === 'draft', 'Only a draft can be edited by the supplier');
      await applyQtyEdits();
      await applyVendorItems();
      await exec(`UPDATE supply_orders SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [order.id]);
      return status;
    }
    case 'send': {
      need(role === 'vendor' && status === 'draft', 'Only the supplier can send a draft');
      await applyQtyEdits();
      await applyVendorItems();
      await setStatus('proposed');
      const count = lines.filter((l: any) => !l._removed).length;
      await notify(exec, buyer, `Order proposed by ${actorName}`, `${count} item${count === 1 ? '' : 's'} ready to confirm.`, order.id);
      return 'proposed';
    }
    case 'confirm': {
      need(role === 'buyer' && status === 'proposed', 'Only the buyer can confirm a proposed order');
      await applyQtyEdits();
      await exec(`UPDATE supply_order_lines SET confirmed_qty = qty WHERE order_id = $1`, [order.id]);
      await setStatus('confirmed', ', confirmed_at = CURRENT_TIMESTAMP');
      await notify(exec, vendor, `${actorName} confirmed the order`, 'You can raise the bill now.', order.id);
      return 'confirmed';
    }
    case 'respond': {
      need(role === 'vendor' && status === 'pending', 'Only the supplier can answer a pending order');
      await applyVendorItems();
      let full = 0;
      let none = 0;
      for (const l of lines) {
        const e = edits.get(l.id);
        const c = e?.confirmed_qty != null && e.confirmed_qty !== '' ? Number(e.confirmed_qty) : Number(l.qty);
        if (!(c >= 0) || c > Number(l.qty) + 1e-9) {
          throw new SupplyOrderInputError(`Confirmed quantity for ${l.item_name} must be between 0 and ${Number(l.qty)}`);
        }
        if (c > 0 && !l.vendor_item_id) throw new SupplyOrderInputError(`Pick your item for ${l.item_name}`);
        await exec(`UPDATE supply_order_lines SET confirmed_qty = $2 WHERE id = $1`, [l.id, round3(c)]);
        if (Math.abs(c - Number(l.qty)) < 1e-9) full++;
        if (c === 0) none++;
      }
      const next: SupplyOrderStatus = none === lines.length ? 'declined' : full === lines.length ? 'confirmed' : 'partial';
      await setStatus(next, next === 'declined' ? '' : ', confirmed_at = CURRENT_TIMESTAMP');
      await notify(
        exec,
        buyer,
        next === 'declined' ? `${actorName} cannot supply this order` : `${actorName} confirmed your order`,
        next === 'partial' ? 'Some quantities are lower than you asked for.' : next === 'confirmed' ? 'All quantities confirmed.' : 'Nothing could be supplied.',
        order.id
      );
      return next;
    }
    case 'decline': {
      need(
        (role === 'buyer' && status === 'proposed') || (role === 'vendor' && status === 'pending'),
        'Only the side that has to answer can decline'
      );
      await setStatus('declined');
      await notify(exec, other, `${actorName} declined the order`, p.note?.slice(0, 300) || 'No reason given.', order.id);
      return 'declined';
    }
    case 'cancel': {
      need(['draft', 'proposed', 'pending', 'confirmed', 'partial'].includes(status), 'This order can no longer be cancelled');
      await setStatus('cancelled');
      if (status !== 'draft') {
        await notify(exec, other, `${actorName} cancelled the order`, p.note?.slice(0, 300) || 'No reason given.', order.id);
      }
      return 'cancelled';
    }
    default:
      throw new SupplyOrderInputError('Unknown action');
  }
}

/** Lines and customer for raising the supplier's invoice from a confirmed order. */
export async function invoiceDraftForOrder(orderId: string, vendorBusinessId: string, client?: PoolClient) {
  const exec = execFor(client);
  const { order, role } = await loadOrderForParty(orderId, vendorBusinessId, client);
  if (role !== 'vendor') throw new SupplyOrderInputError('Order not found', 404);
  if (!['confirmed', 'partial'].includes(order.status)) {
    throw new SupplyOrderInputError('Only a confirmed order can be billed', 409, 'INVALID_STATE');
  }
  const lines = (
    await exec(
      `SELECT l.id, l.item_name, COALESCE(l.confirmed_qty, l.qty) AS qty, l.vendor_item_id,
              i.name, i.unit, i.selling_price, i.tax_rate, i.hsn_sac, COALESCE(i.gst_included, false) AS gst_included
         FROM supply_order_lines l
         LEFT JOIN items i ON i.id = l.vendor_item_id AND i.business_id = $2
        WHERE l.order_id = $1 AND COALESCE(l.confirmed_qty, l.qty) > 0
        ORDER BY l.sort_order`,
      [orderId, vendorBusinessId]
    )
  ).rows;
  const missing = lines.filter((l: any) => !l.vendor_item_id || !l.name);
  if (missing.length) {
    throw new SupplyOrderInputError(`Pick your item for: ${missing.map((l: any) => l.item_name).join(', ')}`, 409, 'ITEMS_UNMAPPED');
  }
  const { ensureVendorCustomerLink } = await import('./supplier-hub-links');
  const customerId = await ensureVendorCustomerLink(vendorBusinessId, order.buyer_business_id, client);
  return {
    customer_id: customerId,
    lines: lines.map((l: any) => ({
      item_id: l.vendor_item_id,
      name: l.name,
      quantity: Number(l.qty),
      unit: l.unit || 'PCS',
      selling_price: Number(l.selling_price) || 0,
      tax_rate: Number(l.tax_rate) || 0,
      hsn_sac: l.hsn_sac || '',
      gst_included: !!l.gst_included,
    })),
  };
}

/**
 * Link a new sales invoice to the order it bills. Called inside the invoice transaction;
 * the invoice must be the supplier's and addressed to the order's buyer.
 */
export async function claimSupplyOrderForInvoice(
  client: PoolClient,
  vendorBusinessId: string,
  orderId: string,
  invoice: { id: string; customer_id: string | null; invoice_number?: string }
): Promise<void> {
  const exec = execFor(client);
  const { order, role } = await loadOrderForParty(orderId, vendorBusinessId, client, true);
  if (role !== 'vendor') throw new SupplyOrderInputError('Order not found', 404);
  if (!['confirmed', 'partial'].includes(order.status)) {
    throw new SupplyOrderInputError('This order is not confirmed, or it has already been billed', 409);
  }
  const customer = invoice.customer_id
    ? (
        await exec(`SELECT linked_business_id FROM customers WHERE id = $1 AND business_id = $2`, [
          invoice.customer_id,
          vendorBusinessId,
        ])
      ).rows[0]
    : null;
  if (customer?.linked_business_id !== order.buyer_business_id) {
    throw new SupplyOrderInputError('Bill the order to the buyer it came from', 400);
  }
  await exec(
    `UPDATE supply_orders SET status = 'invoiced', invoice_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [order.id, invoice.id]
  );
  await notify(
    exec,
    order.buyer_business_id,
    `${await businessName(exec, vendorBusinessId)} billed your order`,
    `Bill ${invoice.invoice_number || ''} is in Incoming bills. Receive it to add the stock.`.replace('  ', ' '),
    order.id
  );
}

/** Mark the order billed by this invoice as received once the buyer has received the bill. */
export async function markSupplyOrderReceived(
  client: PoolClient,
  buyerBusinessId: string,
  invoiceId: string,
  purchaseId: string
): Promise<void> {
  await client.query(
    `UPDATE supply_orders SET status = 'received', purchase_id = $3, updated_at = CURRENT_TIMESTAMP
      WHERE invoice_id = $1 AND buyer_business_id = $2 AND status = 'invoiced'`,
    [invoiceId, buyerBusinessId, purchaseId]
  );
}
