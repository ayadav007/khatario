/**
 * Order list (migration 431): walk the shop, pick what is running out, send each supplier their
 * part. The user only picks items. Each line's supplier fills itself in: the item's default
 * supplier, else the supplier it was last bought from. Lines with no supplier are assigned
 * together, in one pick for many lines, and can be remembered as the items' default supplier.
 *
 * Send groups the lines by supplier: a connected supplier gets a Supplier Hub order; any other
 * supplier gets an order link to send from the user's WhatsApp (lib/supplier-invites).
 */

import type { PoolClient } from 'pg';
import { execFor } from './supplier-hub-links';
import { ITEM_STOCK_SQL } from './low-stock-checker';
import { createSupplyOrder, suggestedBuyerQty } from './supply-orders';
import { createInviteOrder, inviteOrderMessage, inviteOrderPath } from './supplier-invites';

export class OrderListError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'OrderListError';
    this.status = status;
  }
}

type Exec = ReturnType<typeof execFor>;

async function openListId(exec: Exec, businessId: string, userId: string): Promise<string> {
  const found = (await exec(`SELECT id FROM order_lists WHERE business_id = $1 AND status = 'open'`, [businessId])).rows[0];
  if (found) return found.id;
  const made = (
    await exec(
      `INSERT INTO order_lists (business_id, created_by_user_id) VALUES ($1, $2)
       ON CONFLICT (business_id) WHERE status = 'open' DO NOTHING RETURNING id`,
      [businessId, userId]
    )
  ).rows[0];
  if (made) return made.id;
  return (await exec(`SELECT id FROM order_lists WHERE business_id = $1 AND status = 'open'`, [businessId])).rows[0].id;
}

/** SQL: the supplier an item is usually bought from (default supplier, else last purchase). Needs `i`. */
const USUAL_SUPPLIER_SQL = `COALESCE(
  (SELECT s.id FROM suppliers s WHERE s.id = i.default_supplier_id AND s.business_id = i.business_id AND s.deleted_at IS NULL),
  (SELECT p.supplier_id FROM purchase_items pi
     JOIN purchases p ON p.id = pi.purchase_id
     JOIN suppliers s ON s.id = p.supplier_id AND s.deleted_at IS NULL
    WHERE pi.item_id = i.id AND p.business_id = i.business_id AND p.deleted_at IS NULL
      AND COALESCE(p.status, 'final') <> 'cancelled'
    ORDER BY p.bill_date DESC NULLS LAST, p.created_at DESC
    LIMIT 1)
)`;

/** How a supplier gets its order: through Supplier Hub when connected, else a WhatsApp link. */
const WAY_SQL = (s: string) =>
  `CASE WHEN ${s}.linked_business_id IS NOT NULL AND ${s}.approval_status = 'approved' THEN 'hub' ELSE 'whatsapp' END`;

/** The open list (created when needed) and items running low that are not on it yet. */
export async function loadOrderList(businessId: string, userId: string) {
  const exec = execFor();
  const listId = await openListId(exec, businessId, userId);
  const lines = (
    await exec(
      `SELECT l.id, l.item_id, l.qty, i.name, i.unit, i.rack, i.image_url, ${ITEM_STOCK_SQL} AS stock,
              COALESCE(i.min_stock, 0) AS min_stock,
              s.id AS supplier_id, s.name AS supplier_name, ${WAY_SQL('s')} AS way
         FROM order_list_lines l
         JOIN items i ON i.id = l.item_id
         LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.deleted_at IS NULL
        WHERE l.list_id = $1
        ORDER BY i.rack NULLS LAST, i.name`,
      [listId]
    )
  ).rows.map((r: any) => ({
    ...r,
    qty: Number(r.qty),
    stock: Number(r.stock),
    min_stock: Number(r.min_stock),
    way: r.supplier_id ? r.way : null,
  }));

  const low = (
    await exec(
      `SELECT i.id AS item_id, i.name, i.unit, i.rack, ${ITEM_STOCK_SQL} AS stock, i.min_stock, i.reorder_qty, i.max_stock,
              s.name AS supplier_name
         FROM items i
         LEFT JOIN suppliers s ON s.id = ${USUAL_SUPPLIER_SQL}
        WHERE i.business_id = $1 AND i.deleted_at IS NULL AND COALESCE(i.is_active, true) = true
          AND COALESCE(i.item_type, 'goods') <> 'service' AND COALESCE(i.has_variants, false) = false
          AND COALESCE(i.min_stock, 0) > 0 AND ${ITEM_STOCK_SQL} <= i.min_stock
          AND NOT EXISTS (SELECT 1 FROM order_list_lines l WHERE l.list_id = $2 AND l.item_id = i.id)
        ORDER BY i.rack NULLS LAST, i.name
        LIMIT 100`,
      [businessId, listId]
    )
  ).rows.map((r: any) => ({
    item_id: r.item_id,
    name: r.name,
    unit: r.unit,
    rack: r.rack,
    stock: Number(r.stock),
    suggested_qty: suggestedBuyerQty({ current_stock: r.stock, min_stock: r.min_stock, reorder_qty: r.reorder_qty, max_stock: r.max_stock }),
    supplier_name: r.supplier_name,
  }));

  return { list_id: listId, lines, running_low: low };
}

/** Add an item (or set its quantity if it is already on the list). Its usual supplier fills in. */
export async function addToOrderList(p: { businessId: string; userId: string; itemId: string; qty: number }) {
  if (!(p.qty > 0)) throw new OrderListError('Quantity must be more than zero');
  const exec = execFor();
  const item = (
    await exec(
      `SELECT i.id, ${USUAL_SUPPLIER_SQL} AS supplier_id FROM items i
        WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL AND COALESCE(i.item_type, 'goods') <> 'service'`,
      [p.itemId, p.businessId]
    )
  ).rows[0];
  if (!item) throw new OrderListError('Item not found', 404);
  const listId = await openListId(exec, p.businessId, p.userId);
  await exec(
    `INSERT INTO order_list_lines (list_id, item_id, qty, supplier_id, added_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (list_id, item_id) DO UPDATE SET qty = EXCLUDED.qty`,
    [listId, item.id, Math.round(p.qty * 1000) / 1000, item.supplier_id, p.userId]
  );
}

async function ownLine(exec: Exec, businessId: string, lineId: string) {
  const line = (
    await exec(
      `SELECT l.id, l.item_id FROM order_list_lines l JOIN order_lists o ON o.id = l.list_id
        WHERE l.id = $1 AND o.business_id = $2 AND o.status = 'open'`,
      [lineId, businessId]
    )
  ).rows[0];
  if (!line) throw new OrderListError('Line not found', 404);
  return line as { id: string; item_id: string };
}

async function assertOwnSupplier(exec: Exec, businessId: string, supplierId: string) {
  const s = (await exec(`SELECT id FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`, [supplierId, businessId])).rows[0];
  if (!s) throw new OrderListError('Supplier not found', 404);
}

/** Change one line: quantity, supplier (null clears it), or the item's rack. */
export async function updateOrderListLine(
  businessId: string,
  lineId: string,
  patch: { qty?: number; supplier_id?: string | null; rack?: string | null }
) {
  const exec = execFor();
  const line = await ownLine(exec, businessId, lineId);
  if (patch.qty !== undefined) {
    if (!(patch.qty > 0)) throw new OrderListError('Quantity must be more than zero');
    await exec(`UPDATE order_list_lines SET qty = $2 WHERE id = $1`, [line.id, Math.round(patch.qty * 1000) / 1000]);
  }
  if (patch.supplier_id !== undefined) {
    if (patch.supplier_id) await assertOwnSupplier(exec, businessId, patch.supplier_id);
    await exec(`UPDATE order_list_lines SET supplier_id = $2 WHERE id = $1`, [line.id, patch.supplier_id || null]);
  }
  if (patch.rack !== undefined) {
    await exec(`UPDATE items SET rack = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`, [
      line.item_id,
      businessId,
      patch.rack ? String(patch.rack).trim().slice(0, 40) : null,
    ]);
  }
}

export async function removeOrderListLine(businessId: string, lineId: string) {
  const exec = execFor();
  const line = await ownLine(exec, businessId, lineId);
  await exec(`DELETE FROM order_list_lines WHERE id = $1`, [line.id]);
}

/**
 * One supplier for many lines at once. With `remember`, it becomes those items' default
 * supplier, so they fill in by themselves next time.
 */
export async function assignOrderListSupplier(p: { businessId: string; lineIds: string[]; supplierId: string; remember: boolean }) {
  const exec = execFor();
  if (!p.lineIds.length) throw new OrderListError('Pick at least one item');
  await assertOwnSupplier(exec, p.businessId, p.supplierId);
  const updated = (
    await exec(
      `UPDATE order_list_lines l SET supplier_id = $3
         FROM order_lists o
        WHERE o.id = l.list_id AND o.business_id = $1 AND o.status = 'open' AND l.id = ANY($2::uuid[])
        RETURNING l.item_id`,
      [p.businessId, p.lineIds, p.supplierId]
    )
  ).rows;
  if (p.remember && updated.length) {
    await exec(
      `UPDATE items SET default_supplier_id = $3, updated_at = CURRENT_TIMESTAMP
        WHERE business_id = $1 AND id = ANY($2::uuid[])`,
      [p.businessId, updated.map((r: any) => r.item_id), p.supplierId]
    );
  }
  return updated.length;
}

export type OrderListSendResult = {
  supplier_id: string;
  supplier_name: string;
  way: 'hub' | 'whatsapp';
  items: number;
  order_id?: string;
  link?: string;
  message?: string;
  phone?: string | null;
};

/**
 * Send the open list: one order per supplier. Every line needs a supplier first. All of it is
 * one transaction; the list is closed and a fresh one starts next time.
 */
export async function sendOrderList(
  p: { businessId: string; userId: string; baseUrl: string },
  client: PoolClient
): Promise<OrderListSendResult[]> {
  const exec = execFor(client);
  const list = (
    await exec(`SELECT id FROM order_lists WHERE business_id = $1 AND status = 'open' FOR UPDATE`, [p.businessId])
  ).rows[0];
  if (!list) throw new OrderListError('Your order list is empty');
  const lines = (
    await exec(
      `SELECT l.item_id, l.qty, l.supplier_id, s.name AS supplier_name, s.linked_business_id, ${WAY_SQL('s')} AS way
         FROM order_list_lines l
         LEFT JOIN suppliers s ON s.id = l.supplier_id AND s.deleted_at IS NULL
        WHERE l.list_id = $1`,
      [list.id]
    )
  ).rows;
  if (!lines.length) throw new OrderListError('Your order list is empty');
  const missing = lines.filter((l: any) => !l.supplier_name).length;
  if (missing) throw new OrderListError(`Choose a supplier for ${missing} item${missing === 1 ? '' : 's'} first`);

  const bySupplier = new Map<string, any[]>();
  for (const l of lines) {
    if (!bySupplier.has(l.supplier_id)) bySupplier.set(l.supplier_id, []);
    bySupplier.get(l.supplier_id)!.push(l);
  }
  const results: OrderListSendResult[] = [];
  for (const [supplierId, group] of bySupplier) {
    const first = group[0];
    try {
      if (first.way === 'hub') {
        const order = await createSupplyOrder(
          {
            actorBusinessId: p.businessId,
            userId: p.userId,
            role: 'buyer',
            counterpartyBusinessId: first.linked_business_id,
            lines: group.map((l: any) => ({ buyer_item_id: l.item_id, buyer_qty: Number(l.qty) })),
            notes: 'From the order list',
          },
          client
        );
        await exec(`INSERT INTO order_list_sends (list_id, supplier_id, way, supply_order_id) VALUES ($1, $2, 'hub', $3)`, [
          list.id,
          supplierId,
          order.id,
        ]);
        results.push({ supplier_id: supplierId, supplier_name: first.supplier_name, way: 'hub', items: group.length, order_id: order.id });
      } else {
        const made = await createInviteOrder(
          {
            buyerBusinessId: p.businessId,
            userId: p.userId,
            supplierId,
            lines: group.map((l: any) => ({ buyer_item_id: l.item_id, qty: Number(l.qty) })),
          },
          client
        );
        await exec(`INSERT INTO order_list_sends (list_id, supplier_id, way, invite_order_id) VALUES ($1, $2, 'whatsapp', $3)`, [
          list.id,
          supplierId,
          made.order.id,
        ]);
        const link = `${p.baseUrl}${inviteOrderPath(made.order.token)}`;
        results.push({
          supplier_id: supplierId,
          supplier_name: first.supplier_name,
          way: 'whatsapp',
          items: group.length,
          link,
          phone: made.supplier.phone,
          message: inviteOrderMessage({ buyerName: made.buyer_name, supplierName: made.supplier.name, lines: made.message_lines, link }),
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'could not be sent';
      throw new OrderListError(`${first.supplier_name}: ${reason}`);
    }
  }
  await exec(`UPDATE order_lists SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = $1`, [list.id]);
  return results;
}
