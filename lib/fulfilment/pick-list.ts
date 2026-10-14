import { getPool, queryRows } from '@/lib/db';
import { getOrderHubRow, loadOrderFulfilments, type HubScope, type HubSource } from './hub';
import { loadOrderLineRefs, resolveParcelContents } from './parcel-items';

/**
 * Pick list: everything to take off the shelf for a batch of orders, item by item, with the
 * orders each item goes into. Uses the parcel that has not gone out yet (or the whole order when
 * delivery is not tracked), so items already shipped in an earlier parcel are not picked again.
 */

export type PickListItem = {
  key: string;
  item_id: string | null;
  name: string;
  quantity: number;
  sku: string | null;
  location: string | null;
  orders: Array<{ order_number: string; quantity: number }>;
};

export type PickList = {
  orders: Array<{ source: HubSource; id: string; order_number: string; customer_name: string | null }>;
  items: PickListItem[];
  skipped: number;
};

const NOT_OUT = new Set(['new', 'confirmed', 'packed']);

export async function buildPickList(scope: HubScope, refs: Array<{ source: HubSource; id: string }>): Promise<PickList> {
  const pool = getPool();
  const agg = new Map<string, PickListItem>();
  const orders: PickList['orders'] = [];
  let skipped = 0;

  for (const ref of refs.slice(0, 200)) {
    const row = await getOrderHubRow(scope, ref.source, ref.id);
    if (!row) {
      skipped++;
      continue;
    }
    const lines = await loadOrderLineRefs(pool, scope.businessId, { kind: row.source_type, id: row.source_id });
    const parcels = (await loadOrderFulfilments(scope.businessId, row.source_type, row.source_id)).map((f) => {
      const r = f as Record<string, unknown>;
      return { id: f.id, seq: Number(r.seq), status: String(r.status) };
    });

    let toPick: Array<{ line_id: string; quantity: number }>;
    if (parcels.length === 0) {
      toPick = lines.map((l) => ({ line_id: l.line_id, quantity: l.quantity }));
    } else {
      const pending = parcels.filter((p) => NOT_OUT.has(p.status));
      if (pending.length === 0) {
        skipped++;
        continue;
      }
      const explicit = await queryRows<{ fulfilment_id: string; line_id: string; quantity: number }>(
        `SELECT fulfilment_id, line_id, quantity::float8 AS quantity
           FROM order_fulfilment_items WHERE business_id = $1 AND fulfilment_id = ANY($2::uuid[])`,
        [scope.businessId, parcels.map((p) => p.id)],
      );
      const contents = resolveParcelContents(lines, parcels, explicit);
      toPick = pending.flatMap((p) => contents.get(p.id) ?? []);
    }

    const byLine = new Map(lines.map((l) => [l.line_id, l]));
    let any = false;
    for (const t of toPick) {
      const line = byLine.get(t.line_id);
      if (!line || t.quantity <= 0) continue;
      any = true;
      const key = line.item_id ?? `name:${line.name.toLowerCase()}`;
      const cur =
        agg.get(key) ??
        ({ key, item_id: line.item_id, name: line.name, quantity: 0, sku: null, location: null, orders: [] } as PickListItem);
      cur.quantity += t.quantity;
      cur.orders.push({ order_number: row.order_number, quantity: t.quantity });
      agg.set(key, cur);
    }
    if (any) orders.push({ source: row.source_type, id: row.source_id, order_number: row.order_number, customer_name: row.customer_name });
    else skipped++;
  }

  const ids = [...agg.values()].map((i) => i.item_id).filter((v): v is string => Boolean(v));
  if (ids.length > 0) {
    const meta = await queryRows<{ id: string; sku: string | null; location: string | null }>(
      `SELECT id, NULLIF(TRIM(COALESCE(code, '')), '') AS sku, NULL::text AS location
         FROM items WHERE business_id = $1 AND id = ANY($2::uuid[])`,
      [scope.businessId, ids],
    );
    const m = new Map(meta.map((r) => [r.id, r]));
    for (const it of agg.values()) {
      const x = it.item_id ? m.get(it.item_id) : undefined;
      if (x) {
        it.sku = x.sku;
        it.location = x.location;
      }
    }
  }

  const items = [...agg.values()].sort(
    (a, b) => (a.location ?? '~').localeCompare(b.location ?? '~') || a.name.localeCompare(b.name),
  );
  return { orders, items, skipped };
}
