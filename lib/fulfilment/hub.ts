import { queryOne, queryRows } from '@/lib/db';
import { isInvoiceChannel } from '@/lib/invoices/channel';
import { isFulfilmentStatus } from './rules';
import { sanitizeOrderUpdateSettings, type OrderUpdateSettings } from './update-settings';

export const HUB_SOURCES = ['store_order', 'sales_order', 'invoice'] as const;
export type HubSource = (typeof HUB_SOURCES)[number];

export const NEEDS_ACTION = ['to_confirm', 'payment_pending', 'to_pack', 'to_dispatch', 'delivery_failed', 'stale'] as const;
export type NeedsAction = (typeof NEEDS_ACTION)[number];

export interface OrderHubRow {
  source_type: HubSource;
  source_id: string;
  branch_id: string | null;
  channel: string;
  order_number: string;
  invoice_id: string | null;
  invoice_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amount: number;
  payment_status: string | null;
  order_status: string;
  whatsapp_conversation_id: string | null;
  fulfilment_id: string | null;
  delivery_status: string | null;
  method: string | null;
  partner_name: string | null;
  awb: string | null;
  tracking_url: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_code: string | null;
  public_token: string | null;
  cod_amount: number;
  cod_collected_at: string | null;
  created_at: string;
  status_changed_at: string;
}

export function isHubSource(v: unknown): v is HubSource {
  return typeof v === 'string' && (HUB_SOURCES as readonly string[]).includes(v);
}

export function isNeedsAction(v: unknown): v is NeedsAction {
  return typeof v === 'string' && (NEEDS_ACTION as readonly string[]).includes(v);
}

const UNPAID = `('unpaid', 'pending', 'partial', 'partially_paid', 'failed')`;

/** SQL predicate per "needs action" bucket; `$sla` is the hours placeholder. */
function needsPredicate(key: NeedsAction, sla: string): string {
  switch (key) {
    case 'to_confirm':
      return `(h.delivery_status = 'new' AND h.source_type <> 'invoice' AND h.payment_status IN ('paid', 'cod'))`;
    case 'payment_pending':
      return `(h.source_type <> 'invoice' AND h.payment_status IN ${UNPAID} AND h.cod_amount = 0
               AND h.delivery_status NOT IN ('cancelled', 'returned', 'delivered'))`;
    case 'to_pack':
      return `(h.delivery_status = 'confirmed' AND h.payment_status IN ('paid', 'cod'))`;
    case 'to_dispatch':
      return `(h.delivery_status = 'packed')`;
    case 'delivery_failed':
      return `(h.delivery_status = 'delivery_failed')`;
    case 'stale':
      return `(h.delivery_status IN ('new', 'confirmed', 'packed') AND h.payment_status = 'paid'
               AND h.created_at < NOW() - make_interval(hours => ${sla}::int))`;
  }
}

export interface HubScope {
  businessId: string;
  /** null = every branch (admin). */
  branchIds: string[] | null;
}

function scopeSql(scope: HubScope, params: unknown[]): string {
  params.push(scope.businessId);
  let sql = `h.business_id = $${params.length}`;
  if (scope.branchIds) {
    params.push(scope.branchIds);
    sql += ` AND (h.branch_id IS NULL OR h.branch_id = ANY($${params.length}::uuid[]))`;
  }
  return sql;
}

export async function loadOrderUpdateSettings(businessId: string): Promise<OrderUpdateSettings> {
  const row = await queryOne<{ s: unknown }>(
    `SELECT order_update_settings AS s FROM business_settings WHERE business_id = $1`,
    [businessId],
  ).catch(() => null);
  return sanitizeOrderUpdateSettings(row?.s);
}

export async function loadDispatchSlaHours(businessId: string): Promise<number> {
  return (await loadOrderUpdateSettings(businessId)).dispatchSlaHours;
}

export async function listOrderHub(
  scope: HubScope,
  filter: {
    channel?: string | null;
    deliveryStatus?: string | null;
    needs?: string | null;
    q?: string | null;
    page?: number;
    limit?: number;
    slaHours: number;
  },
): Promise<{ rows: OrderHubRow[]; total: number }> {
  const params: unknown[] = [];
  const where = [scopeSql(scope, params)];
  if (isInvoiceChannel(filter.channel)) {
    params.push(filter.channel);
    where.push(`h.channel = $${params.length}`);
  }
  if (filter.deliveryStatus === 'untracked') {
    where.push(`h.delivery_status IS NULL`);
  } else if (isFulfilmentStatus(filter.deliveryStatus)) {
    params.push(filter.deliveryStatus);
    where.push(`h.delivery_status = $${params.length}`);
  }
  if (isNeedsAction(filter.needs)) {
    if (filter.needs === 'stale') params.push(filter.slaHours);
    where.push(needsPredicate(filter.needs, `$${params.length}`));
  }
  const q = (filter.q ?? '').trim().slice(0, 80);
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(
      `(h.order_number ILIKE ${p} OR COALESCE(h.invoice_number, '') ILIKE ${p} OR COALESCE(h.customer_name, '') ILIKE ${p}
        OR COALESCE(h.customer_phone, '') ILIKE ${p} OR COALESCE(h.awb, '') ILIKE ${p})`,
    );
  }
  const whereSql = where.join(' AND ');
  const limit = Math.min(100, Math.max(1, filter.limit ?? 25));
  const page = Math.max(1, filter.page ?? 1);

  const total = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM order_hub h WHERE ${whereSql}`, params);
  const rows = await queryRows<OrderHubRow>(
    `SELECT h.source_type, h.source_id, h.branch_id, h.channel, h.order_number, h.invoice_id, h.invoice_number,
            h.customer_id, h.customer_name, h.customer_phone, h.amount::float8 AS amount, h.payment_status,
            h.order_status, h.whatsapp_conversation_id, h.fulfilment_id, h.delivery_status, h.method,
            h.partner_name, h.awb, h.tracking_url, h.rider_name, h.rider_phone, h.pickup_code, h.public_token,
            h.cod_amount::float8 AS cod_amount, h.cod_collected_at, h.created_at, h.status_changed_at
       FROM order_hub h
      WHERE ${whereSql}
      ORDER BY h.created_at DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params,
  );
  return { rows, total: total?.n ?? 0 };
}

export async function orderHubNeedsCounts(scope: HubScope, slaHours: number): Promise<Record<NeedsAction, number>> {
  const params: unknown[] = [];
  const scopeWhere = scopeSql(scope, params);
  params.push(slaHours);
  const sla = `$${params.length}`;
  const cols = NEEDS_ACTION.map((k) => `COUNT(*) FILTER (WHERE ${needsPredicate(k, sla)})::int AS ${k}`).join(',\n');
  const row = await queryOne<Record<NeedsAction, number>>(
    `SELECT ${cols} FROM order_hub h
      WHERE ${scopeWhere} AND h.created_at > NOW() - INTERVAL '90 days'`,
    params,
  );
  return Object.fromEntries(NEEDS_ACTION.map((k) => [k, Number(row?.[k] ?? 0)])) as Record<NeedsAction, number>;
}

export async function getOrderHubRow(scope: HubScope, source: HubSource, id: string): Promise<OrderHubRow | null> {
  const params: unknown[] = [];
  const scopeWhere = scopeSql(scope, params);
  params.push(source, id);
  return queryOne<OrderHubRow>(
    `SELECT h.*, h.amount::float8 AS amount, h.cod_amount::float8 AS cod_amount
       FROM order_hub h
      WHERE ${scopeWhere} AND h.source_type = $${params.length - 1} AND h.source_id = $${params.length}`,
    params,
  );
}

export interface OrderLine {
  name: string;
  quantity: number;
  amount: number;
}

export async function loadOrderLines(businessId: string, source: HubSource, id: string): Promise<OrderLine[]> {
  const sql =
    source === 'store_order'
      ? `SELECT COALESCE(soi.item_name || COALESCE(' (' || soi.variant_name || ')', ''), 'Item') AS name,
                soi.quantity::float8 AS quantity, soi.line_total::float8 AS amount
           FROM store_order_items soi JOIN store_orders so ON so.id = soi.order_id
          WHERE soi.order_id = $1 AND so.business_id = $2 ORDER BY soi.id`
      : source === 'sales_order'
        ? `SELECT soi.item_name AS name, soi.qty::float8 AS quantity, COALESCE(soi.line_total, 0)::float8 AS amount
             FROM sales_order_items soi JOIN sales_orders s ON s.id = soi.sales_order_id
            WHERE soi.sales_order_id = $1 AND s.business_id = $2 ORDER BY soi.sort_order, soi.id`
        : `SELECT ii.item_name AS name, ii.quantity::float8 AS quantity, COALESCE(ii.line_total, 0)::float8 AS amount
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE ii.invoice_id = $1 AND i.business_id = $2 ORDER BY ii.sort_order, ii.id`;
  return queryRows<OrderLine>(sql, [id, businessId]).catch(() => []);
}

export interface ShipAddress {
  address: string | null;
  pincode: string | null;
}

export interface ShipFrom {
  name: string;
  address: string | null;
  pincode: string | null;
  phone: string | null;
  gstin: string | null;
}

const joinParts = (...parts: Array<string | null | undefined>) =>
  parts.map((p) => (p ?? '').trim()).filter(Boolean).join(', ') || null;

/**
 * Where the order goes: the store checkout address, else the invoice or sales order shipping
 * address, else the customer's shipping address, else their main address.
 */
export async function loadShipTo(businessId: string, source: HubSource, id: string): Promise<ShipAddress> {
  if (source === 'store_order') {
    const r = await queryOne<{ address: string | null; pincode: string | null }>(
      `SELECT customer_address AS address, customer_pincode AS pincode FROM store_orders WHERE id = $1 AND business_id = $2`,
      [id, businessId],
    );
    return { address: joinParts(r?.address), pincode: r?.pincode?.trim() || null };
  }
  const r = await queryOne<{
    doc_ship: string | null;
    inv_ship: string | null;
    c_ship: string | null;
    c_ship_city: string | null;
    c_ship_state: string | null;
    c_ship_pin: string | null;
    c_addr: string | null;
    c_city: string | null;
    c_state: string | null;
    c_pin: string | null;
  }>(
    source === 'sales_order'
      ? `SELECT s.shipping_address AS doc_ship, i.shipping_address AS inv_ship,
                c.shipping_address AS c_ship, c.shipping_city AS c_ship_city, c.shipping_state AS c_ship_state,
                c.shipping_pincode AS c_ship_pin, c.address AS c_addr, c.city AS c_city, c.state AS c_state, c.pincode AS c_pin
           FROM sales_orders s
           LEFT JOIN invoices i ON i.id = s.converted_invoice_id AND i.business_id = s.business_id
           LEFT JOIN customers c ON c.id = COALESCE(s.customer_id, i.customer_id) AND c.business_id = s.business_id
          WHERE s.id = $1 AND s.business_id = $2`
      : `SELECT NULL::text AS doc_ship, i.shipping_address AS inv_ship,
                c.shipping_address AS c_ship, c.shipping_city AS c_ship_city, c.shipping_state AS c_ship_state,
                c.shipping_pincode AS c_ship_pin, c.address AS c_addr, c.city AS c_city, c.state AS c_state, c.pincode AS c_pin
           FROM invoices i
           LEFT JOIN customers c ON c.id = i.customer_id AND c.business_id = i.business_id
          WHERE i.id = $1 AND i.business_id = $2`,
    [id, businessId],
  ).catch(() => null);
  if (!r) return { address: null, pincode: null };
  const doc = joinParts(r.doc_ship) ?? joinParts(r.inv_ship);
  if (doc) return { address: doc, pincode: r.c_ship_pin?.trim() || r.c_pin?.trim() || null };
  if (joinParts(r.c_ship)) {
    return { address: joinParts(r.c_ship, r.c_ship_city, r.c_ship_state), pincode: r.c_ship_pin?.trim() || null };
  }
  return { address: joinParts(r.c_addr, r.c_city, r.c_state), pincode: r.c_pin?.trim() || null };
}

export async function loadShipFrom(businessId: string): Promise<ShipFrom | null> {
  const b = await queryOne<{
    name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    phone: string | null;
    gstin: string | null;
  }>(
    `SELECT name, address_line1, address_line2, city, state, pincode, phone, gstin FROM businesses WHERE id = $1`,
    [businessId],
  );
  if (!b) return null;
  return {
    name: b.name,
    address: joinParts(b.address_line1, b.address_line2, b.city, b.state),
    pincode: b.pincode?.trim() || null,
    phone: b.phone?.trim() || null,
    gstin: b.gstin?.trim() || null,
  };
}

export async function loadOrderFulfilments(businessId: string, source: HubSource, id: string) {
  const col = source === 'store_order' ? 'store_order_id' : source === 'sales_order' ? 'sales_order_id' : 'invoice_id';
  const extra =
    source === 'sales_order' ? 'AND f.store_order_id IS NULL' : source === 'invoice' ? 'AND f.store_order_id IS NULL AND f.sales_order_id IS NULL' : '';
  const fulfilments = await queryRows<Record<string, unknown> & { id: string; public_token: string }>(
    `SELECT f.id, f.seq, f.status, f.method, f.partner_name, f.awb, f.tracking_url, f.rider_name, f.rider_phone,
            f.pickup_code, f.proof_photo_url, f.cod_amount::float8 AS cod_amount, f.cod_collected_at,
            f.failure_reason, f.public_token, f.ship_address, f.ship_pincode, f.packages,
            f.weight_kg::float8 AS weight_kg, f.carrier_shipment_id, f.label_url, f.manifest_url,
            f.pickup_scheduled_at, f.booking_error,
            f.status_changed_at, f.created_at
       FROM order_fulfilments f
      WHERE f.business_id = $1 AND f.${col} = $2 ${extra}
      ORDER BY f.seq`,
    [businessId, id],
  );
  if (fulfilments.length === 0) return [];
  const events = await queryRows<{ fulfilment_id: string; status: string; note: string | null; actor_type: string; created_at: string }>(
    `SELECT fulfilment_id, status, note, actor_type, created_at
       FROM order_fulfilment_events
      WHERE business_id = $1 AND fulfilment_id = ANY($2::uuid[])
      ORDER BY created_at, id`,
    [businessId, fulfilments.map((f) => f.id)],
  );
  return fulfilments.map((f) => ({ ...f, events: events.filter((e) => e.fulfilment_id === f.id) }));
}
