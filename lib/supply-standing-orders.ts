/**
 * Standing orders (migration 429): the same order on fixed weekdays, for goods bought daily
 * (milk, bread, eggs, papers). The buyer proposes it, the supplier accepts it once, and from then
 * on each due day becomes a confirmed supply order the supplier bills as usual. Either side can
 * pause or end it; the buyer can resume a paused one.
 */

import type { PoolClient } from 'pg';
import { execFor } from './supplier-hub-links';
import { queueHubWhatsApp } from './supplier-hub-whatsapp';
import { prepareLines, type NewLine } from './supply-orders';
import { priceOrderLines } from './supplier-hub-pricing';

export class StandingOrderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'StandingOrderError';
    this.status = status;
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdaysLabel(days: number[]): string {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  return sorted.length === 7 ? 'every day' : sorted.map((d) => DAY_NAMES[d]).join(', ');
}

/** Today's date and weekday (0 = Sunday) in Indian time. */
export function todayInIndia(now = new Date()): { date: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: DAY_NAMES.indexOf(get('weekday')) };
}

async function tell(exec: ReturnType<typeof execFor>, businessId: string, title: string, message: string, path: string) {
  await exec(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'general', $2, $3, 'supply_standing_order', NULL, CURRENT_TIMESTAMP)`,
    [businessId, title, message]
  );
  await queueHubWhatsApp(exec, businessId, { title, detail: message, path });
}

async function nameOf(exec: ReturnType<typeof execFor>, id: string) {
  return (await exec(`SELECT name FROM businesses WHERE id = $1`, [id])).rows[0]?.name || 'A business';
}

/** Buyer proposes a standing order to a connected supplier (lines as for a normal order). */
export async function createStandingOrder(
  p: { buyerBusinessId: string; userId: string; vendorBusinessId: string; weekdays: unknown; lines: NewLine[]; notes?: string | null },
  client?: PoolClient
) {
  const exec = execFor(client);
  const days = Array.isArray(p.weekdays) ? Array.from(new Set(p.weekdays.map(Number))).filter((d) => d >= 0 && d <= 6) : [];
  if (!days.length) throw new StandingOrderError('Pick at least one day');
  const link = (
    await exec(
      `SELECT 1 FROM suppliers WHERE business_id = $1 AND linked_business_id = $2 AND approval_status = 'approved' AND deleted_at IS NULL`,
      [p.buyerBusinessId, p.vendorBusinessId]
    )
  ).rows[0];
  if (!link) throw new StandingOrderError('You are not connected with this supplier', 403);
  const lines = await prepareLines(exec, p.buyerBusinessId, p.vendorBusinessId, p.lines, false);
  const row = (
    await exec(
      `INSERT INTO supply_standing_orders (buyer_business_id, vendor_business_id, weekdays, notes, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, status`,
      [p.buyerBusinessId, p.vendorBusinessId, days, p.notes?.slice(0, 500) || null, p.userId]
    )
  ).rows[0];
  let sort = 0;
  for (const l of lines) {
    await exec(
      `INSERT INTO supply_standing_order_lines (standing_order_id, buyer_item_id, vendor_item_id, item_name, qty, buyer_units_per_vendor_unit, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, l.buyerItemId, l.vendorItemId, l.name, l.qty, l.factor, sort++]
    );
  }
  await tell(
    exec,
    p.vendorBusinessId,
    `${await nameOf(exec, p.buyerBusinessId)} wants a standing order`,
    `${lines.length} item${lines.length === 1 ? '' : 's'}, ${weekdaysLabel(days)}. Accept it once and each order arrives confirmed.`,
    '/suppliers/hub'
  );
  return row as { id: string; status: string };
}

/** Standing orders of a business, as buyer or supplier, with their lines. */
export async function listStandingOrders(businessId: string, role: 'buyer' | 'vendor') {
  const mine = role === 'buyer' ? 'so.buyer_business_id' : 'so.vendor_business_id';
  const theirs = role === 'buyer' ? 'so.vendor_business_id' : 'so.buyer_business_id';
  return (
    await execFor()(
      `SELECT so.id, so.status, so.weekdays, so.notes, so.last_run_on, so.created_at, ${theirs} AS other_business_id,
              b.name AS other_business_name,
              COALESCE(json_agg(json_build_object('item_name', l.item_name, 'qty', l.qty) ORDER BY l.sort_order)
                FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
         FROM supply_standing_orders so
         JOIN businesses b ON b.id = ${theirs}
         LEFT JOIN supply_standing_order_lines l ON l.standing_order_id = so.id
        WHERE ${mine} = $1 AND so.status <> 'ended'
        GROUP BY so.id, b.name
        ORDER BY so.created_at DESC`,
      [businessId]
    )
  ).rows;
}

/**
 * accept / decline (supplier, while proposed); pause / end (either side); resume (buyer, paused).
 */
export async function actOnStandingOrder(p: { id: string; businessId: string; action: string }, client?: PoolClient) {
  const exec = execFor(client);
  const so = (await exec(`SELECT * FROM supply_standing_orders WHERE id = $1 FOR UPDATE`, [p.id])).rows[0];
  if (!so || (so.buyer_business_id !== p.businessId && so.vendor_business_id !== p.businessId)) {
    throw new StandingOrderError('Standing order not found', 404);
  }
  const role = so.buyer_business_id === p.businessId ? 'buyer' : 'vendor';
  const other = role === 'buyer' ? so.vendor_business_id : so.buyer_business_id;
  const name = await nameOf(exec, p.businessId);
  const set = (status: string, extra = '') =>
    exec(`UPDATE supply_standing_orders SET status = $2 ${extra} WHERE id = $1`, [so.id, status]);
  const label = weekdaysLabel(so.weekdays);
  switch (p.action) {
    case 'accept':
      if (role !== 'vendor' || so.status !== 'proposed') throw new StandingOrderError('Only the supplier can accept a proposed standing order', 409);
      await set('active', ', accepted_at = CURRENT_TIMESTAMP');
      await tell(exec, other, `${name} accepted your standing order`, `It runs ${label}. Each order arrives confirmed.`, '/supply-orders');
      return 'active';
    case 'decline':
      if (role !== 'vendor' || so.status !== 'proposed') throw new StandingOrderError('Only the supplier can decline a proposed standing order', 409);
      await set('ended');
      await tell(exec, other, `${name} declined your standing order`, 'Order from them as usual instead.', '/supply-orders');
      return 'ended';
    case 'pause':
      if (so.status !== 'active') throw new StandingOrderError('Only a running standing order can be paused', 409);
      await set('paused');
      await tell(exec, other, `${name} paused a standing order`, `The ${label} order will not be created until it is resumed.`, '/supply-orders');
      return 'paused';
    case 'resume':
      if (role !== 'buyer' || so.status !== 'paused') throw new StandingOrderError('Only the buyer can resume a paused standing order', 409);
      await set('active');
      await tell(exec, other, `${name} resumed a standing order`, `It runs ${label} again.`, '/supply-orders');
      return 'active';
    case 'end':
      if (so.status === 'ended') throw new StandingOrderError('Already ended', 409);
      await set('ended');
      await tell(exec, other, `${name} ended a standing order`, `The ${label} order stops.`, '/supply-orders');
      return 'ended';
    default:
      throw new StandingOrderError('Unknown action');
  }
}

/**
 * Create today's orders for running standing orders due today (Indian time), once per day, as
 * confirmed supply orders. Skips pairs no longer connected. Returns how many were created.
 */
export async function runDueStandingOrders(now = new Date()): Promise<number> {
  const exec = execFor();
  const { date, weekday } = todayInIndia(now);
  const due = (
    await exec(
      `SELECT so.* FROM supply_standing_orders so
        WHERE so.status = 'active' AND $1 = ANY(so.weekdays)
          AND (so.last_run_on IS NULL OR so.last_run_on < $2::date)
          AND EXISTS (SELECT 1 FROM suppliers s WHERE s.business_id = so.buyer_business_id
                        AND s.linked_business_id = so.vendor_business_id AND s.approval_status = 'approved' AND s.deleted_at IS NULL)`,
      [weekday, date]
    )
  ).rows;
  let created = 0;
  for (const so of due) {
    const order = (
      await exec(
        `INSERT INTO supply_orders (
           buyer_business_id, vendor_business_id, status, origin, notes, created_by_business_id,
           confirmed_at, standing_order_id, standing_run_on
         )
         VALUES ($1, $2, 'confirmed', 'standing', $3, $1, CURRENT_TIMESTAMP, $4, $5::date)
         ON CONFLICT (standing_order_id, standing_run_on) WHERE standing_order_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [so.buyer_business_id, so.vendor_business_id, so.notes, so.id, date]
      )
    ).rows[0];
    await exec(`UPDATE supply_standing_orders SET last_run_on = $2::date WHERE id = $1`, [so.id, date]);
    if (!order) continue;
    await exec(
      `INSERT INTO supply_order_lines (order_id, buyer_item_id, vendor_item_id, item_name, qty, confirmed_qty, buyer_units_per_vendor_unit, sort_order)
       SELECT $1, buyer_item_id, vendor_item_id, item_name, qty, qty, buyer_units_per_vendor_unit, sort_order
         FROM supply_standing_order_lines WHERE standing_order_id = $2`,
      [order.id, so.id]
    );
    // Priced on the day it is made, like a bill dated today for this customer.
    await priceOrderLines(exec, order.id);
    created++;
    await tell(
      exec,
      so.vendor_business_id,
      `Standing order for ${await nameOf(exec, so.buyer_business_id)} today`,
      'Already confirmed. Create the bill when you send it.',
      `/supply-orders/${order.id}`
    );
  }
  return created;
}
