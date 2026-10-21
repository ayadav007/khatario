import type { PoolClient } from 'pg';

/**
 * Which order lines travel in which parcel (Shopify "fulfil some items").
 *
 * A parcel with rows in order_fulfilment_items carries exactly those quantities. A parcel without
 * rows carries the rest of the order: whatever no other parcel lists. With one parcel (the usual
 * case) nothing is stored and the parcel holds the whole order.
 */

type Db = Pick<PoolClient, 'query'>;

export type OrderLineRef = { line_id: string; item_id: string | null; name: string; quantity: number };
export type ParcelLine = { line_id: string; name: string; quantity: number };

export class ParcelItemsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ParcelItemsError';
  }
}

type Source = { kind: 'store_order' | 'sales_order' | 'invoice'; id: string };

/** The order a parcel belongs to, the same way the hub resolves it. */
function sourceOf(row: { store_order_id: string | null; sales_order_id: string | null; invoice_id: string | null }): Source | null {
  if (row.store_order_id) return { kind: 'store_order', id: row.store_order_id };
  if (row.sales_order_id) return { kind: 'sales_order', id: row.sales_order_id };
  if (row.invoice_id) return { kind: 'invoice', id: row.invoice_id };
  return null;
}

/** Order lines with what is still to travel: items removed before packing (order edit) are left out. */
export async function loadOrderLineRefs(db: Db, businessId: string, source: Source): Promise<OrderLineRef[]> {
  const sql =
    source.kind === 'store_order'
      ? `SELECT soi.id AS line_id, soi.item_id,
                COALESCE(soi.item_name || COALESCE(' (' || soi.variant_name || ')', ''), 'Item') AS name,
                GREATEST(0, soi.quantity - COALESCE((SELECT SUM(COALESCE(ri.received_qty, ri.quantity)) FROM order_return_items ri
                  JOIN order_returns r ON r.id = ri.return_id
                 WHERE r.business_id = $2 AND r.removed_before_dispatch AND r.status IN ('received', 'closed')
                   AND r.store_order_id = $1 AND ri.item_id = soi.item_id), 0))::float8 AS quantity
           FROM store_order_items soi JOIN store_orders so ON so.id = soi.order_id
          WHERE soi.order_id = $1 AND so.business_id = $2 ORDER BY soi.id`
      : source.kind === 'sales_order'
        ? `SELECT soi.id AS line_id, soi.item_id, soi.item_name AS name,
                  GREATEST(0, soi.qty - COALESCE((SELECT SUM(COALESCE(ri.received_qty, ri.quantity)) FROM order_return_items ri
                  JOIN order_returns r ON r.id = ri.return_id
                 WHERE r.business_id = $2 AND r.removed_before_dispatch AND r.status IN ('received', 'closed')
                   AND r.sales_order_id = $1 AND ri.item_id = soi.item_id), 0))::float8 AS quantity
             FROM sales_order_items soi JOIN sales_orders s ON s.id = soi.sales_order_id
            WHERE soi.sales_order_id = $1 AND s.business_id = $2 ORDER BY soi.sort_order, soi.id`
        : `SELECT ii.id AS line_id, ii.item_id, COALESCE(ii.item_name, ii.description, 'Item') AS name,
                  GREATEST(0, ii.quantity - COALESCE((SELECT SUM(COALESCE(ri.received_qty, ri.quantity)) FROM order_return_items ri
                    JOIN order_returns r ON r.id = ri.return_id
                   WHERE r.business_id = $2 AND r.removed_before_dispatch AND r.status IN ('received', 'closed')
                     AND ri.invoice_item_id = ii.id), 0))::float8 AS quantity
             FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE ii.invoice_id = $1 AND i.business_id = $2
              AND COALESCE(ii.charge_line, false) = false
            ORDER BY ii.sort_order, ii.id`;
  const r = await db.query<OrderLineRef>(sql, [source.id, businessId]);
  return r.rows.filter((l) => l.quantity > 1e-9);
}

type ParcelRow = { id: string; seq: number; status: string };

/** Contents of every parcel of an order, filling the "rest of the order" for parcels without a list. */
export function resolveParcelContents(
  lines: OrderLineRef[],
  parcels: ParcelRow[],
  explicit: Array<{ fulfilment_id: string; line_id: string; quantity: number }>,
): Map<string, ParcelLine[]> {
  const out = new Map<string, ParcelLine[]>();
  const live = parcels.filter((p) => p.status !== 'cancelled');
  const listed = new Set(explicit.map((e) => e.fulfilment_id));
  const used = new Map<string, number>();
  const name = new Map(lines.map((l) => [l.line_id, l.name]));
  for (const p of parcels) {
    if (!listed.has(p.id)) continue;
    const rows = explicit.filter((e) => e.fulfilment_id === p.id);
    out.set(
      p.id,
      rows.map((e) => ({ line_id: e.line_id, name: name.get(e.line_id) ?? 'Item', quantity: Number(e.quantity) })),
    );
    if (p.status !== 'cancelled') {
      for (const e of rows) used.set(e.line_id, (used.get(e.line_id) ?? 0) + Number(e.quantity));
    }
  }
  // The first unlisted live parcel takes everything left; later unlisted ones are empty.
  const rest = live.filter((p) => !listed.has(p.id)).sort((a, b) => a.seq - b.seq);
  rest.forEach((p, i) => {
    if (i > 0) {
      out.set(p.id, []);
      return;
    }
    out.set(
      p.id,
      lines
        .map((l) => ({ line_id: l.line_id, name: l.name, quantity: Math.max(0, l.quantity - (used.get(l.line_id) ?? 0)) }))
        .filter((l) => l.quantity > 1e-9),
    );
  });
  for (const p of parcels) if (!out.has(p.id)) out.set(p.id, []);
  return out;
}

export async function loadParcelContents(
  db: Db,
  businessId: string,
  source: Source,
  parcels: ParcelRow[],
): Promise<Map<string, ParcelLine[]>> {
  if (parcels.length === 0) return new Map();
  const [lines, explicit] = await Promise.all([
    loadOrderLineRefs(db, businessId, source),
    db
      .query<{ fulfilment_id: string; line_id: string; quantity: number }>(
        `SELECT fulfilment_id, line_id, quantity::float8 AS quantity
           FROM order_fulfilment_items WHERE business_id = $1 AND fulfilment_id = ANY($2::uuid[])`,
        [businessId, parcels.map((p) => p.id)],
      )
      .then((r) => r.rows),
  ]);
  return resolveParcelContents(lines, parcels, explicit);
}

/**
 * Sets what goes in one parcel. An empty list puts the parcel back to "the rest of the order".
 * Only parcels that have not left the shop can change.
 */
export async function setParcelItems(
  client: PoolClient,
  p: { businessId: string; fulfilmentId: string; items: Array<{ line_id: string; quantity: number }> },
): Promise<void> {
  const found = await client.query<{
    id: string;
    status: string;
    store_order_id: string | null;
    sales_order_id: string | null;
    invoice_id: string | null;
  }>(
    `SELECT id, status, store_order_id, sales_order_id, invoice_id
       FROM order_fulfilments WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [p.fulfilmentId, p.businessId],
  );
  const row = found.rows[0];
  if (!row) throw new ParcelItemsError(404, 'NOT_FOUND', 'Parcel not found');
  if (!['new', 'confirmed', 'packed'].includes(row.status)) {
    throw new ParcelItemsError(409, 'PARCEL_GONE', 'This parcel has already gone out; its contents cannot change');
  }
  const source = sourceOf(row);
  if (!source) throw new ParcelItemsError(409, 'NO_ORDER', 'This parcel is not linked to an order');

  const lines = await loadOrderLineRefs(client, p.businessId, source);
  const byId = new Map(lines.map((l) => [l.line_id, l]));

  // What the order's other live parcels have explicitly taken.
  const others = await client.query<{ line_id: string; q: number }>(
    `SELECT i.line_id, SUM(i.quantity)::float8 AS q
       FROM order_fulfilment_items i
       JOIN order_fulfilments x ON x.id = i.fulfilment_id
      WHERE i.business_id = $1 AND x.id <> $2 AND x.status <> 'cancelled'
        AND x.store_order_id IS NOT DISTINCT FROM $3::uuid
        AND x.sales_order_id IS NOT DISTINCT FROM $4::uuid
        AND x.invoice_id IS NOT DISTINCT FROM $5::uuid
      GROUP BY i.line_id`,
    [p.businessId, row.id, row.store_order_id, row.sales_order_id, row.invoice_id],
  );
  const taken = new Map(others.rows.map((r) => [r.line_id, Number(r.q) || 0]));

  const merged = new Map<string, number>();
  for (const it of p.items) {
    const q = Number(it.quantity);
    if (!Number.isFinite(q) || q < 0) throw new ParcelItemsError(400, 'INVALID_QTY', 'Quantities must be zero or more');
    if (q === 0) continue;
    merged.set(it.line_id, (merged.get(it.line_id) ?? 0) + q);
  }
  for (const [lineId, q] of merged) {
    const line = byId.get(lineId);
    if (!line) throw new ParcelItemsError(400, 'LINE_NOT_ON_ORDER', 'An item is not on this order');
    const left = line.quantity - (taken.get(lineId) ?? 0);
    if (q > left + 1e-9) {
      throw new ParcelItemsError(400, 'EXCEEDS_ORDER', `${line.name}: only ${Math.max(0, left)} left to pack`);
    }
  }

  await client.query(`DELETE FROM order_fulfilment_items WHERE fulfilment_id = $1 AND business_id = $2`, [row.id, p.businessId]);
  for (const [lineId, q] of merged) {
    await client.query(
      `INSERT INTO order_fulfilment_items (business_id, fulfilment_id, line_id, item_name, quantity)
       VALUES ($1, $2, $3, $4, $5)`,
      [p.businessId, row.id, lineId, byId.get(lineId)!.name.slice(0, 255), q],
    );
  }
}
