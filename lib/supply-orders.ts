/**
 * Supplier Hub orders (migration 393): multi-line orders between a buyer and a connected supplier.
 *
 *   supplier side: draft -> proposed -> (buyer) confirmed
 *   buyer side:    pending -> (supplier) confirmed | partial | declined
 *   then:          invoiced -> dispatched (optional) -> received; cancelled any time before invoicing
 * What a supplier cannot send yet on a partly confirmed order becomes a backorder: a new pending
 * order for the rest, which the supplier confirms when stock arrives (migration 423).
 * A buyer's first order can travel with its connection request (awaiting_link, migration 425):
 * accepting the request makes it pending, declining or withdrawing cancels it.
 *
 * Line quantities are in the supplier's unit (qty, confirmed_qty); buyer_units_per_vendor_unit
 * converts them to the buyer's unit. Suggested drafts are built from the buyer's own reorder
 * levels for items whose default supplier is the connected supplier and who share low stock.
 */

import type { PoolClient } from 'pg';
import { BUYER_PRICE_JOIN } from '@/lib/pricing/buyer-price-sql';
import { execFor, type Exec } from './supplier-hub-links';
import { saveItemLink } from './supplier-item-links';
import { queueHubWhatsApp } from './supplier-hub-whatsapp';
import { ITEM_STOCK_SQL } from './low-stock-checker';

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
  | 'awaiting_link'
  | 'draft'
  | 'proposed'
  | 'pending'
  | 'confirmed'
  | 'partial'
  | 'declined'
  | 'invoiced'
  | 'dispatched'
  | 'received'
  | 'cancelled';

export const OPEN_STATUSES: SupplyOrderStatus[] = ['awaiting_link', 'draft', 'proposed', 'pending', 'confirmed', 'partial', 'invoiced', 'dispatched'];

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Days of sales a suggested order should cover when the buyer set no reorder quantity. */
export const SALES_COVER_DAYS = 14;

/**
 * How many of the buyer's units to order for an item at or below its reorder level: up to the
 * maximum, else the reorder quantity, else two weeks of last month's sales, else twice the level.
 */
export function suggestedBuyerQty(item: {
  current_stock: unknown;
  min_stock: unknown;
  reorder_qty?: unknown;
  max_stock?: unknown;
  /** Units sold in the last 30 days */
  sold_30?: unknown;
}): number {
  const current = Math.max(0, Number(item.current_stock) || 0);
  const min = Number(item.min_stock) || 0;
  const reorder = Number(item.reorder_qty) || 0;
  const max = Number(item.max_stock) || 0;
  const sold = Number(item.sold_30) || 0;
  let qty: number;
  if (max > 0) qty = max - current;
  else if (reorder > 0) qty = reorder;
  else if (sold > 0) qty = Math.max(Math.ceil((sold / 30) * SALES_COVER_DAYS) - current, min);
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

/** In-app notice about an order, plus the same update on WhatsApp once the change commits. */
async function notify(exec: Exec, businessId: string, title: string, message: string, orderId: string) {
  await exec(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'general', $2, $3, 'supply_order', $4, CURRENT_TIMESTAMP)`,
    [businessId, title, message, orderId]
  );
  await queueHubWhatsApp(exec, businessId, { title, detail: message, path: `/supply-orders/${orderId}` });
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
  // Items, and sizes / colours of items with variants, at or below their own reorder level.
  const candidates = await exec(
    `
    SELECT i.id AS item_id, NULL::uuid AS variant_id, i.name, i.business_id AS buyer_id, s.linked_business_id AS vendor_id,
           ${ITEM_STOCK_SQL} AS current_stock, i.min_stock, i.reorder_qty, i.max_stock,
           (SELECT COALESCE(SUM(ii.quantity), 0) FROM invoice_items ii JOIN invoices inv ON inv.id = ii.invoice_id
             WHERE ii.item_id = i.id AND inv.business_id = i.business_id AND inv.status = 'final'
               AND inv.invoice_date >= CURRENT_DATE - 30) AS sold_30
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
      AND ${ITEM_STOCK_SQL} <= i.min_stock
      AND NOT EXISTS (
        SELECT 1 FROM supply_order_lines l
        JOIN supply_orders o ON o.id = l.order_id
        WHERE l.buyer_item_id = i.id
          AND o.buyer_business_id = i.business_id
          AND o.vendor_business_id = s.linked_business_id
          AND o.status = ANY($${args.length + 1}::text[])
      )
      ${where.length ? `AND ${where.join(' AND ')}` : ''}
    UNION ALL
    SELECT i.id, v.id, i.name || ' – ' || v.variant_name, i.business_id, s.linked_business_id,
           v.current_stock, v.min_stock, v.reorder_qty, NULL,
           (SELECT COALESCE(SUM(ii.quantity), 0) FROM invoice_items ii JOIN invoices inv ON inv.id = ii.invoice_id
             WHERE ii.variant_id = v.id AND inv.business_id = i.business_id AND inv.status = 'final'
               AND inv.invoice_date >= CURRENT_DATE - 30)
    FROM item_variants v
    JOIN items i ON i.id = v.item_id
    JOIN suppliers s
      ON s.id = i.default_supplier_id AND s.business_id = i.business_id
     AND s.approval_status = 'approved' AND s.allow_low_stock_access = true
     AND s.linked_business_id IS NOT NULL AND s.deleted_at IS NULL
    WHERE i.deleted_at IS NULL
      AND COALESCE(i.is_active, true) = true
      AND COALESCE(i.has_variants, false) = true
      AND COALESCE(v.min_stock, 0) > 0
      AND COALESCE(v.current_stock, 0) <= v.min_stock
      AND NOT EXISTS (
        SELECT 1 FROM supply_order_lines l
        JOIN supply_orders o ON o.id = l.order_id
        WHERE l.buyer_variant_id = v.id
          AND o.buyer_business_id = i.business_id
          AND o.vendor_business_id = s.linked_business_id
          AND o.status = ANY($${args.length + 1}::text[])
      )
      ${where.length ? `AND ${where.join(' AND ')}` : ''}
    ORDER BY 4, 5, 3
    `,
    [...args, OPEN_STATUSES]
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
           buyer_stock_at_suggestion, sort_order, buyer_variant_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          order.id,
          it.item_id,
          link?.vendorItemId ?? null,
          it.name,
          vendorQtyFor(suggestedBuyerQty(it), factor),
          factor,
          Number(it.current_stock) || 0,
          sort++,
          it.variant_id,
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
  /** One of the listing's sizes / colours (supplier_listing_options.id) */
  option_id?: string | null;
};

/** Validate and normalise lines for a new order between buyer and vendor. */
export async function prepareLines(
  exec: Exec,
  buyer: string,
  vendor: string,
  raw: NewLine[],
  catalogOnly: boolean,
  publicOnly = false
) {
  if (!Array.isArray(raw) || raw.length === 0) throw new SupplyOrderInputError('Add at least one item');
  if (raw.length > 200) throw new SupplyOrderInputError('At most 200 lines per order');
  const out: Array<{
    buyerItemId: string | null;
    vendorItemId: string | null;
    name: string;
    qty: number;
    factor: number;
    price: number | null;
    optionLabel: string | null;
  }> = [];
  for (const line of raw) {
    let buyerItemId = line.buyer_item_id ? String(line.buyer_item_id) : null;
    let vendorItemId = line.vendor_item_id ? String(line.vendor_item_id) : null;
    let factor = 1;
    let name = '';
    let listing: { listing_id: string | null; listed: boolean | null; moq: unknown; order_multiple: unknown; price: unknown } | null = null;
    let price: number | null = null;
    let optionLabel: string | null = null;
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
          `SELECT i.name, l.id AS listing_id, l.display_name, l.is_active AS listed, l.audience, l.moq, l.order_multiple,
                  l.price, bp.price AS buyer_price
             FROM items i
             ${BUYER_PRICE_JOIN('i.business_id', '$3::uuid', 'i.id')}
             LEFT JOIN supplier_published_listings l ON l.item_id = i.id AND l.supplier_business_id = i.business_id
            WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL`,
          [vendorItemId, vendor, buyer]
        )
      ).rows[0];
      if (!theirs) throw new SupplyOrderInputError("An item on this order is not one of the supplier's items");
      listing = theirs;
      if (catalogOnly && !buyerItemId && !theirs.listed) {
        throw new SupplyOrderInputError('Only items from the supplier’s published catalog can be ordered directly');
      }
      if (publicOnly && !(theirs.listed && theirs.audience === 'public_preview')) {
        throw new SupplyOrderInputError('Before you are connected, order only from the supplier’s public catalogue');
      }
      if (!buyerItemId) {
        const link = await bestLinkForVendorItem(exec, buyer, vendor, vendorItemId);
        if (link) {
          buyerItemId = link.buyerItemId;
          factor = link.factor;
        }
      }
      if (!name) name = theirs.display_name || theirs.name;
      // The supplier's price for this buyer wins; then the option's price, then the catalogue price.
      if (line.option_id) {
        const opt = theirs.listing_id
          ? (
              await exec(`SELECT label, price FROM supplier_listing_options WHERE id = $1 AND listing_id = $2`, [
                line.option_id,
                theirs.listing_id,
              ])
            ).rows[0]
          : null;
        if (!opt) throw new SupplyOrderInputError(`Pick one of the listed options for ${name}`);
        optionLabel = opt.label;
        if (opt.price != null) price = Number(opt.price);
      }
      if (theirs.buyer_price != null) price = Number(theirs.buyer_price);
      else if (price == null && theirs.listed && theirs.price != null) price = Number(theirs.price);
    }
    if (!buyerItemId && !vendorItemId) throw new SupplyOrderInputError('Each line needs an item');

    const qty =
      line.qty != null && line.qty !== ''
        ? Number(line.qty)
        : line.buyer_qty != null && line.buyer_qty !== ''
          ? vendorQtyFor(Number(line.buyer_qty), factor)
          : NaN;
    if (!(qty > 0)) throw new SupplyOrderInputError(`Quantity for ${name} must be more than zero`);
    if (catalogOnly && listing?.listed) {
      const moq = Number(listing.moq) || 0;
      const multiple = Number(listing.order_multiple) || 0;
      if (moq > 0 && qty < moq) throw new SupplyOrderInputError(`Order at least ${moq} of ${name}`);
      if (multiple > 0 && Math.abs(qty / multiple - Math.round(qty / multiple)) > 1e-9) {
        throw new SupplyOrderInputError(`Order ${name} in multiples of ${multiple}`);
      }
    }
    out.push({ buyerItemId, vendorItemId, name: name.slice(0, 255), qty: round3(qty), factor, price, optionLabel });
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
    /** Buyer's first order, sent with this pending connection request (public catalogue only) */
    connectionRequestId?: string;
  },
  client?: PoolClient
): Promise<{ id: string; status: SupplyOrderStatus }> {
  const exec = execFor(client);
  const buyer = p.role === 'buyer' ? p.actorBusinessId : p.counterpartyBusinessId;
  const vendor = p.role === 'buyer' ? p.counterpartyBusinessId : p.actorBusinessId;
  if (buyer === vendor) throw new SupplyOrderInputError('Choose another business');
  const withRequest = p.role === 'buyer' && !!p.connectionRequestId;
  if (withRequest) {
    const req = (
      await exec(
        `SELECT 1 FROM supplier_connection_requests
          WHERE id = $1 AND buyer_business_id = $2 AND supplier_business_id = $3 AND status = 'pending'`,
        [p.connectionRequestId, buyer, vendor]
      )
    ).rows[0];
    if (!req) throw new SupplyOrderInputError('The connection request is no longer pending', 409);
  } else if (!(await approvedLink(exec, buyer, vendor))) {
    throw new SupplyOrderInputError('You are not connected with this business', 403, 'NOT_LINKED');
  }
  const lines = await prepareLines(exec, buyer, vendor, p.lines, p.origin === 'catalog' || withRequest, withRequest);
  const status: SupplyOrderStatus = withRequest
    ? 'awaiting_link'
    : p.role === 'buyer'
      ? 'pending'
      : p.send
        ? 'proposed'
        : 'draft';
  const origin = withRequest ? 'catalog' : p.origin ?? (p.role === 'buyer' ? 'buyer' : 'vendor');

  const order = (
    await exec(
      `INSERT INTO supply_orders (
         buyer_business_id, vendor_business_id, status, origin, need_by, notes,
         created_by_business_id, created_by_user_id, connection_request_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, status`,
      [
        buyer,
        vendor,
        status,
        origin,
        p.needBy || null,
        p.notes?.slice(0, 1000) || null,
        p.actorBusinessId,
        p.userId,
        withRequest ? p.connectionRequestId : null,
      ]
    )
  ).rows[0];
  let sort = 0;
  for (const l of lines) {
    await exec(
      `INSERT INTO supply_order_lines (
         order_id, buyer_item_id, vendor_item_id, item_name, qty, buyer_units_per_vendor_unit, sort_order, unit_price, option_label
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [order.id, l.buyerItemId, l.vendorItemId, l.name, l.qty, l.factor, sort++, l.price, l.optionLabel]
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

/**
 * SQL: price per supplier unit a connected buyer sees for an order line, given the supplier's
 * item `vi` and its active catalog listing `pl` (LEFT JOINed with LISTING_FOR_LINE_SQL). The
 * catalog price wins; otherwise the supplier's list price, unless the listing hides prices.
 */
export const BUYER_LINE_PRICE_SQL = `COALESCE(l.unit_price, bp.price, pl.price, CASE WHEN pl.id IS NULL OR pl.price_display <> 'hidden' THEN vi.selling_price END)`;

/** SQL join for `pl`, the active listing of line `l`'s supplier item; `vendorParam` is the supplier's business id. */
export const LISTING_FOR_LINE_SQL = (vendorParam: string, buyerParam?: string) =>
  `LEFT JOIN supplier_published_listings pl
     ON pl.supplier_business_id = ${vendorParam} AND pl.item_id = l.vendor_item_id AND pl.is_active = true
   ${BUYER_PRICE_JOIN(vendorParam, buyerParam ?? `(SELECT buyer_business_id FROM supply_orders so WHERE so.id = l.order_id)`, 'l.vendor_item_id')}`;

const STATUS_GROUPS: Record<string, SupplyOrderStatus[]> = {
  open: OPEN_STATUSES,
  done: ['received', 'declined', 'cancelled'],
};

/** Statuses that wait on this side: the supplier's drafts, orders to answer and to bill; the buyer's proposals and bills. */
export const ACTION_STATUSES: Record<'buyer' | 'vendor', SupplyOrderStatus[]> = {
  vendor: ['draft', 'pending', 'confirmed', 'partial'],
  buyer: ['proposed', 'invoiced', 'dispatched'],
};

/**
 * Orders of `businessId` as buyer or supplier. group: action (waiting on this side), open, done
 * or all. The buyer never sees the supplier's drafts.
 */
export async function listSupplyOrders(
  businessId: string,
  role: 'buyer' | 'vendor',
  group: string,
  client?: PoolClient
) {
  const statuses = group === 'action' ? ACTION_STATUSES[role] : STATUS_GROUPS[group] ?? null;
  const mine = role === 'buyer' ? 'o.buyer_business_id' : 'o.vendor_business_id';
  const theirs = role === 'buyer' ? 'o.vendor_business_id' : 'o.buyer_business_id';
  const args: any[] = [businessId];
  let statusSql = '';
  if (statuses) {
    args.push(statuses);
    statusSql = `AND o.status = ANY($2::text[])`;
  }
  const { rows } = await execFor(client)(
    `
    SELECT o.id, o.status, o.origin, o.need_by, o.created_at, o.updated_at, o.invoice_id, o.parent_order_id,
           ${theirs} AS other_business_id, ob.name AS other_business_name,
           (SELECT COUNT(*)::int FROM supply_order_lines l WHERE l.order_id = o.id) AS line_count,
           inv.invoice_number
    FROM supply_orders o
    JOIN businesses ob ON ob.id = ${theirs}
    LEFT JOIN invoices inv ON inv.id = o.invoice_id
    WHERE ${mine} = $1
      ${statusSql}
      ${role === 'buyer' ? "AND o.status <> 'draft'" : ''}
    ORDER BY o.updated_at DESC
    LIMIT 200
    `,
    args
  );
  return rows;
}

export type LineEdit = {
  id: string;
  qty?: number | string | null;
  confirmed_qty?: number | string | null;
  vendor_item_id?: string | null;
  /** Buyer units in one supplier unit, set with vendor_item_id on a line that had no match */
  factor?: number | string | null;
  /** respond: keep the unconfirmed rest as a backorder (default true) */
  backorder?: boolean;
  remove?: boolean;
};

/**
 * Move an order along. Actions:
 *   update  — supplier edits a draft (qty, supplier item, remove lines)
 *   send    — supplier sends a draft to the buyer (proposed)
 *   confirm — buyer agrees a proposed order, optionally changing quantities
 *   respond — supplier answers a pending order with the quantity it can supply per line; the
 *             rest of each short line goes on a backorder unless the line says backorder: false
 *   decline — the side that has to answer turns it down
 *   cancel  — either side, before it is invoiced
 *   dispatch — supplier marks a billed order as sent (note: transporter, LR or vehicle number)
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

  /**
   * Apply supplier-item choices (and learn the match) for a supplier acting on lines. A line
   * with no supplier item was asked for in the buyer's units; with `factor` (buyer units in one
   * supplier unit) its quantity becomes whole supplier units.
   */
  const applyVendorItems = async () => {
    for (const l of lines) {
      const e = edits.get(l.id);
      if (!e?.vendor_item_id || e.vendor_item_id === l.vendor_item_id) continue;
      const own = (
        await exec(`SELECT 1 FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`, [e.vendor_item_id, vendor])
      ).rows[0];
      if (!own) throw new SupplyOrderInputError('Pick one of your own items');
      const wasUnmatched = !l.vendor_item_id;
      let factor = Number(l.buyer_units_per_vendor_unit) || 1;
      if (wasUnmatched && e.factor != null && e.factor !== '') {
        const f = Number(e.factor);
        if (!(f > 0)) throw new SupplyOrderInputError(`Units per pack for ${l.item_name} must be more than zero`);
        if (Math.abs(f - factor) > 1e-9) {
          const buyerQty = Number(l.qty) * factor;
          factor = round3(f);
          l.qty = vendorQtyFor(buyerQty, factor);
          l.buyer_units_per_vendor_unit = factor;
          await exec(`UPDATE supply_order_lines SET qty = $2, buyer_units_per_vendor_unit = $3 WHERE id = $1`, [l.id, l.qty, factor]);
        }
      }
      await exec(`UPDATE supply_order_lines SET vendor_item_id = $2 WHERE id = $1`, [l.id, e.vendor_item_id]);
      l.vendor_item_id = e.vendor_item_id;
      if (l.buyer_item_id) {
        await saveItemLink(
          {
            buyerBusinessId: buyer,
            vendorBusinessId: vendor,
            buyerItemId: l.buyer_item_id,
            vendorItemId: e.vendor_item_id,
            factor: wasUnmatched ? factor : null,
            source: 'request',
            userId: p.userId,
          },
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

  /** A pending order for the rest of the short lines, linked to this one. */
  const openBackorder = async (rest: Array<{ line: any; qty: number }>) => {
    const bo = (
      await exec(
        `INSERT INTO supply_orders (
           buyer_business_id, vendor_business_id, status, origin, need_by, notes,
           created_by_business_id, created_by_user_id, parent_order_id
         )
         VALUES ($1, $2, 'pending', 'backorder', $3, $4, $2, $5, $6)
         RETURNING id`,
        [buyer, vendor, order.need_by, order.notes, p.userId, order.id]
      )
    ).rows[0];
    let sort = 0;
    for (const { line, qty } of rest) {
      await exec(
        `INSERT INTO supply_order_lines (
           order_id, buyer_item_id, vendor_item_id, item_name, qty, buyer_units_per_vendor_unit, sort_order, unit_price, option_label
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          bo.id,
          line.buyer_item_id,
          line.vendor_item_id,
          line.item_name,
          qty,
          line.buyer_units_per_vendor_unit,
          sort++,
          line.unit_price,
          line.option_label,
        ]
      );
    }
    return bo.id as string;
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
      const rest: Array<{ line: any; qty: number }> = [];
      for (const l of lines) {
        const e = edits.get(l.id);
        const c = e?.confirmed_qty != null && e.confirmed_qty !== '' ? Number(e.confirmed_qty) : Number(l.qty);
        if (!(c >= 0) || c > Number(l.qty) + 1e-9) {
          throw new SupplyOrderInputError(`Confirmed quantity for ${l.item_name} must be between 0 and ${Number(l.qty)}`);
        }
        if (c > 0 && !l.vendor_item_id) throw new SupplyOrderInputError(`Pick your item for ${l.item_name}`);
        await exec(`UPDATE supply_order_lines SET confirmed_qty = $2 WHERE id = $1`, [l.id, round3(c)]);
        if (Math.abs(c - Number(l.qty)) < 1e-9) full++;
        else if (e?.backorder !== false) rest.push({ line: l, qty: round3(Number(l.qty) - c) });
        if (c === 0) none++;
      }
      const next: SupplyOrderStatus = none === lines.length ? 'declined' : full === lines.length ? 'confirmed' : 'partial';
      await setStatus(next, next === 'declined' ? '' : ', confirmed_at = CURRENT_TIMESTAMP');
      // What has a backup supplier goes there now; the rest waits here as a backorder.
      const shortAll = lines
        .map((l: any) => ({ line: l, qty: round3(Number(l.qty) - Number(edits.get(l.id)?.confirmed_qty ?? l.qty)) }))
        .filter((s: { qty: number }) => s.qty > 1e-9);
      const sentToBackup = await routeToBackups(exec, order, shortAll, client);
      const restLeft = rest.filter((r) => !sentToBackup.has(r.line.id));
      rest.length = 0;
      rest.push(...restLeft);
      // Nothing confirmed means nothing ships now; the buyer can order again, so no backorder then.
      const backorderId = next === 'partial' && rest.length ? await openBackorder(rest) : null;
      await notify(
        exec,
        buyer,
        next === 'declined' ? `${actorName} cannot supply this order` : `${actorName} confirmed your order`,
        next === 'partial'
          ? backorderId
            ? `Some quantities are lower than you asked for. The rest of ${rest.length} item${rest.length === 1 ? '' : 's'} is on a backorder ${actorName} will confirm when stock arrives.`
            : 'Some quantities are lower than you asked for.'
          : next === 'confirmed'
            ? 'All quantities confirmed.'
            : 'Nothing could be supplied.',
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
      if (role === 'vendor') {
        await routeToBackups(exec, order, lines.map((l: any) => ({ line: l, qty: Number(l.qty) })), client);
      }
      return 'declined';
    }
    case 'cancel': {
      need(
        ['draft', 'proposed', 'pending', 'confirmed', 'partial'].includes(status) || (status === 'awaiting_link' && role === 'buyer'),
        'This order can no longer be cancelled'
      );
      await setStatus('cancelled');
      if (status !== 'draft' && status !== 'awaiting_link') {
        await notify(exec, other, `${actorName} cancelled the order`, p.note?.slice(0, 300) || 'No reason given.', order.id);
      }
      return 'cancelled';
    }
    case 'dispatch': {
      need(role === 'vendor' && status === 'invoiced', 'Only the supplier can mark a billed order as dispatched');
      const note = p.note?.trim().slice(0, 300) || null;
      await exec(
        `UPDATE supply_orders SET status = 'dispatched', dispatched_at = CURRENT_TIMESTAMP, dispatch_note = $2,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [order.id, note]
      );
      await notify(exec, buyer, `${actorName} dispatched your order`, note ? `On the way: ${note}` : 'Your order is on the way.', order.id);
      return 'dispatched';
    }
    default:
      throw new SupplyOrderInputError('Unknown action');
  }
}

/**
 * Send what a supplier could not supply to each line's backup supplier (items.backup_supplier_id,
 * a connected supplier of the buyer other than this one), as one pending order per backup
 * supplier. Returns the ids of the lines that went to a backup.
 */
async function routeToBackups(
  exec: Exec,
  order: any,
  short: Array<{ line: any; qty: number }>,
  client?: PoolClient
): Promise<Set<string>> {
  const sent = new Set<string>();
  const withItem = short.filter((s) => s.line.buyer_item_id && s.qty > 0);
  if (!withItem.length) return sent;
  const backups = (
    await exec(
      `SELECT i.id AS item_id, s.linked_business_id AS vendor_id
         FROM items i
         JOIN suppliers s ON s.id = i.backup_supplier_id AND s.business_id = i.business_id
        WHERE i.business_id = $1 AND i.id = ANY($2::uuid[])
          AND s.approval_status = 'approved' AND s.deleted_at IS NULL
          AND s.linked_business_id IS NOT NULL AND s.linked_business_id <> $3`,
      [order.buyer_business_id, withItem.map((s) => s.line.buyer_item_id), order.vendor_business_id]
    )
  ).rows;
  const byVendor = new Map<string, Array<{ line: any; qty: number }>>();
  for (const s of withItem) {
    const b = backups.find((r: any) => r.item_id === s.line.buyer_item_id);
    if (!b) continue;
    if (!byVendor.has(b.vendor_id)) byVendor.set(b.vendor_id, []);
    byVendor.get(b.vendor_id)!.push(s);
  }
  const buyerName = await businessName(exec, order.buyer_business_id);
  const firstName = await businessName(exec, order.vendor_business_id);
  for (const [vendorId, items] of byVendor) {
    const lines = await prepareLines(
      exec,
      order.buyer_business_id,
      vendorId,
      items.map((s) => ({
        buyer_item_id: s.line.buyer_item_id,
        buyer_qty: round3(s.qty * (Number(s.line.buyer_units_per_vendor_unit) || 1)),
      })),
      false
    );
    const bo = (
      await exec(
        `INSERT INTO supply_orders (
           buyer_business_id, vendor_business_id, status, origin, need_by, notes, created_by_business_id, parent_order_id
         )
         VALUES ($1, $2, 'pending', 'backup', $3, $4, $1, $5)
         RETURNING id`,
        [order.buyer_business_id, vendorId, order.need_by, `Backup for an order ${firstName} could not fully supply`, order.id]
      )
    ).rows[0];
    let sort = 0;
    for (const l of lines) {
      await exec(
        `INSERT INTO supply_order_lines (order_id, buyer_item_id, vendor_item_id, item_name, qty, buyer_units_per_vendor_unit, sort_order, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [bo.id, l.buyerItemId, l.vendorItemId, l.name, l.qty, l.factor, sort++, l.price]
      );
    }
    for (const s of items) sent.add(s.line.id);
    await notify(exec, vendorId, `New order from ${buyerName}`, `${lines.length} item${lines.length === 1 ? '' : 's'}. Confirm the quantities you can supply.`, bo.id);
    await notify(
      exec,
      order.buyer_business_id,
      `Sent to your backup supplier`,
      `${firstName} could not supply ${lines.length} item${lines.length === 1 ? '' : 's'}; they went to your backup supplier.`,
      bo.id
    );
  }
  void client;
  return sent;
}

/**
 * When a connection request is accepted, the first order sent with it goes to the supplier as
 * a pending order; when it is declined or withdrawn, that order is cancelled.
 */
export async function settleOrdersForRequest(
  requestId: string,
  outcome: 'accepted' | 'closed',
  client?: PoolClient
): Promise<number> {
  const exec = execFor(client);
  const moved = await exec(
    `UPDATE supply_orders SET status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE connection_request_id = $1 AND status = 'awaiting_link'
      RETURNING id, buyer_business_id, vendor_business_id,
        (SELECT COUNT(*)::int FROM supply_order_lines l WHERE l.order_id = supply_orders.id) AS line_count`,
    [requestId, outcome === 'accepted' ? 'pending' : 'cancelled']
  );
  if (outcome === 'accepted') {
    for (const o of moved.rows) {
      await notify(
        exec,
        o.vendor_business_id,
        `First order from ${await businessName(exec, o.buyer_business_id)}`,
        `${o.line_count} item${o.line_count === 1 ? '' : 's'} from your catalogue. Confirm the quantities you can supply.`,
        o.id
      );
    }
  }
  return moved.rowCount || 0;
}

export type OrderComment = {
  id: string;
  body: string;
  created_at: string;
  mine: boolean;
  business_name: string;
  user_name: string | null;
};

/** The thread on an order, oldest first, for either of its businesses. */
export async function listOrderComments(orderId: string, businessId: string, client?: PoolClient): Promise<OrderComment[]> {
  const exec = execFor(client);
  const { order, role } = await loadOrderForParty(orderId, businessId, client);
  if (role === 'buyer' && order.status === 'draft') throw new SupplyOrderInputError('Order not found', 404);
  const rows = (
    await exec(
      `SELECT c.id, c.body, c.created_at, c.business_id = $2 AS mine, b.name AS business_name, u.name AS user_name
         FROM supply_order_comments c
         JOIN businesses b ON b.id = c.business_id
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.order_id = $1
        ORDER BY c.created_at
        LIMIT 500`,
      [orderId, businessId]
    )
  ).rows;
  return rows.map((r: any) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

/** Add a comment to an order and tell the other business (in the app and on WhatsApp). */
export async function addOrderComment(
  p: { orderId: string; businessId: string; userId: string; body: string },
  client?: PoolClient
): Promise<OrderComment> {
  const exec = execFor(client);
  const body = String(p.body || '').trim().slice(0, 2000);
  if (!body) throw new SupplyOrderInputError('Write a message first');
  const { order, role } = await loadOrderForParty(p.orderId, p.businessId, client);
  if (role === 'buyer' && order.status === 'draft') throw new SupplyOrderInputError('Order not found', 404);
  const row = (
    await exec(
      `INSERT INTO supply_order_comments (order_id, business_id, user_id, body) VALUES ($1, $2, $3, $4)
       RETURNING id, body, created_at`,
      [order.id, p.businessId, p.userId, body]
    )
  ).rows[0];
  const name = await businessName(exec, p.businessId);
  // The other side does not see a supplier's draft yet, so it is not told about notes on one.
  if (order.status !== 'draft') {
    const other = role === 'buyer' ? order.vendor_business_id : order.buyer_business_id;
    await notify(exec, other, `${name} wrote on the order`, body.slice(0, 200), order.id);
  }
  return { id: row.id, body: row.body, created_at: new Date(row.created_at).toISOString(), mine: true, business_name: name, user_name: null };
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
              COALESCE(l.option_label, bv.variant_name) AS option_label,
              i.name, i.unit, COALESCE(l.unit_price, bp.price, i.selling_price) AS selling_price,
              i.tax_rate, i.hsn_sac, COALESCE(i.gst_included, false) AS gst_included
         FROM supply_order_lines l
         LEFT JOIN items i ON i.id = l.vendor_item_id AND i.business_id = $2
         LEFT JOIN item_variants bv ON bv.id = l.buyer_variant_id
         ${BUYER_PRICE_JOIN('$2::uuid', '$3::uuid', 'l.vendor_item_id')}
        WHERE l.order_id = $1 AND COALESCE(l.confirmed_qty, l.qty) > 0
        ORDER BY l.sort_order`,
      [orderId, vendorBusinessId, order.buyer_business_id]
    )
  ).rows;
  const missing = lines.filter((l: any) => !l.vendor_item_id || !l.name);
  if (missing.length) {
    throw new SupplyOrderInputError(`Pick your item for: ${missing.map((l: any) => l.item_name).join(', ')}`, 409, 'ITEMS_UNMAPPED');
  }
  const { ensureVendorCustomerLink } = await import('./supplier-hub-links');
  const customerId = await ensureVendorCustomerLink(vendorBusinessId, order.buyer_business_id, client);
  // The bill's place of supply and the buyer's input tax credit come from this customer's
  // state and GSTIN, so fill any gaps from the buyer's own business (a GSTIN only when no
  // other customer of the supplier already has it).
  await exec(
    `UPDATE customers c SET
       state = COALESCE(NULLIF(c.state, ''), b.state),
       state_code = COALESCE(NULLIF(c.state_code, ''), b.state_code),
       gstin = CASE
         WHEN NULLIF(c.gstin, '') IS NULL AND NULLIF(b.gstin, '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM customers o
             WHERE o.business_id = c.business_id AND o.id <> c.id AND o.deleted_at IS NULL AND UPPER(o.gstin) = UPPER(b.gstin)
          )
         THEN UPPER(b.gstin) ELSE c.gstin END,
       updated_at = CURRENT_TIMESTAMP
     FROM businesses b
     WHERE c.id = $1 AND c.business_id = $2 AND b.id = $3
       AND (NULLIF(c.state, '') IS NULL OR NULLIF(c.state_code, '') IS NULL OR NULLIF(c.gstin, '') IS NULL)`,
    [customerId, vendorBusinessId, order.buyer_business_id]
  );
  // What would stop the bill being finalised, so the supplier can fix it before opening it.
  const biz = (
    await exec(
      `SELECT COALESCE(NULLIF(TRIM(b.address_line1), ''), (
                SELECT br.address_line1 FROM branches br
                 WHERE br.business_id = b.id AND NULLIF(TRIM(br.address_line1), '') IS NOT NULL LIMIT 1)) AS address,
              b.state, b.state_code
         FROM businesses b WHERE b.id = $1`,
      [vendorBusinessId]
    )
  ).rows[0];
  const warnings: Array<{ code: 'business_address' | 'hsn'; message: string; href: string }> = [];
  if (!String(biz?.address || '').trim() || !(biz?.state || biz?.state_code)) {
    warnings.push({
      code: 'business_address',
      message: 'Add your business address and state; a tax invoice needs them.',
      href: '/settings/business',
    });
  }
  for (const l of lines.filter((x: any) => !String(x.hsn_sac || '').trim())) {
    warnings.push({ code: 'hsn', message: `Add the HSN code for ${l.name}.`, href: `/items/${l.vendor_item_id}` });
  }
  return {
    customer_id: customerId,
    warnings,
    lines: lines.map((l: any) => ({
      item_id: l.vendor_item_id,
      name: l.option_label ? `${l.name} (${l.option_label})` : l.name,
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
      WHERE invoice_id = $1 AND buyer_business_id = $2 AND status IN ('invoiced', 'dispatched')`,
    [invoiceId, buyerBusinessId, purchaseId]
  );
}
