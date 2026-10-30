import type { PoolClient } from 'pg';
import { getPool, query, queryOne } from '@/lib/db';
import { enqueueCustomerPush } from '@/lib/push/customer-push';
import { notifyStoreEvent } from '@/lib/store/notify-whatsapp';
import { storePublicHostname } from '@/lib/store/subdomain';

/**
 * Abandoned-cart recovery (spec 2026-10-29-store-shopping-features §7): a server-side copy of each
 * signed-in shopper's cart, one reminder when it is left behind, and recovery when they order.
 */

import { cartReminderMessage, canRemindManually, type CartLine } from '@/lib/store/abandoned-cart-format';

// Pure helpers live in a client-safe module; re-exported so existing imports keep working.
export { cartReminderMessage, canRemindManually };
export type { CartLine };

export type DueCart = {
  id: string;
  businessId: string;
  customerId: string;
  phone: string;
  customerName: string;
  storeName: string;
  storeSubdomain: string;
  lines: CartLine[];
  subtotal: number;
};

export type CartReminderResult = { sent: boolean; channel: 'push' | 'whatsapp' | null; error?: string };

export const CART_MAX_LINES = 50;
export const CART_MAX_QUANTITY = 999;
const CART_MAX_PRICE = 10_000_000;
/** NUMERIC(12,2) holds below 1e10. */
const CART_MAX_SUBTOTAL = 1e10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CART_ERROR_TEXT = {
  too_many_lines: `A cart holds at most ${CART_MAX_LINES} lines`,
  bad_quantity: 'Quantity must be 1 to 999',
  bad_line: 'A cart line is not valid',
} as const;

export class CartError extends Error {
  constructor(public code: keyof typeof CART_ERROR_TEXT) {
    super(CART_ERROR_TEXT[code]);
  }
}

const lineKey = (l: CartLine) => `${l.item_id}:${l.variant_id ?? ''}`;

/** Union by item and variant; the server quantity wins; server lines first, then new local ones. */
export function mergeCarts(local: CartLine[], server: CartLine[]): CartLine[] {
  const seen = new Set(server.map(lineKey));
  const out = [...server];
  for (const l of local) {
    const k = lineKey(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

export function cartSubtotal(lines: CartLine[]): number {
  const total = lines.reduce((s, l) => s + Number(l.price) * Number(l.quantity), 0);
  return Math.round(total * 100) / 100;
}

/** Push text: "Rice is still…" for one line, "Rice, Ghee are still…" / "… and 2 more are still…" for more. */
export function cartPushBody(lines: CartLine[], storeName: string, total: number): string {
  const msg = cartReminderMessage(lines, { name: storeName }, total);
  const verb = lines.length === 1 ? 'is' : 'are';
  return `${msg.item_names} ${verb} still in your cart at ${storeName}. Total ₹${msg.total}.`;
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://khatario.com').replace(/\/+$/, '');
}

/** Store cart page; store hosts rewrite /cart to /store/cart. Same host rule as the khata link. */
export function cartLink(storeSubdomain: string): string {
  const app = new URL(appBaseUrl());
  return `${app.protocol}//${storePublicHostname(storeSubdomain, app.host)}/cart`;
}

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Every line checked before it reaches the row: ids, quantity, price, name and image. */
function validLines(lines: CartLine[]): CartLine[] {
  if (!Array.isArray(lines)) throw new CartError('bad_line');
  if (lines.length > CART_MAX_LINES) throw new CartError('too_many_lines');
  const clean = lines.map((l) => {
    if (!l || typeof l !== 'object') throw new CartError('bad_line');
    const q = Number(l.quantity);
    if (!Number.isInteger(q) || q < 1 || q > CART_MAX_QUANTITY) throw new CartError('bad_quantity');
    if (!isUuid(l.item_id)) throw new CartError('bad_line');
    const variant = l.variant_id ?? null;
    if (variant !== null && !isUuid(variant)) throw new CartError('bad_line');
    const price = typeof l.price === 'number' ? l.price : Number.NaN;
    if (!Number.isFinite(price) || price < 0 || price > CART_MAX_PRICE) throw new CartError('bad_line');
    const name = typeof l.name === 'string' ? l.name.trim().slice(0, 200) : '';
    if (!name) throw new CartError('bad_line');
    const image = l.image_url ?? null;
    if (image !== null && (typeof image !== 'string' || image.length > 1000)) throw new CartError('bad_line');
    return {
      item_id: l.item_id,
      variant_id: variant,
      quantity: q,
      price: Math.round(price * 100) / 100,
      name,
      image_url: image,
    };
  });
  const subtotal = cartSubtotal(clean);
  if (!Number.isFinite(subtotal) || subtotal >= CART_MAX_SUBTOTAL) throw new CartError('bad_line');
  return clean;
}

/**
 * Upserts the shopper's cart from already-priced lines. Empty → `cleared` (a `recovered` cart stays
 * recovered, so clearing the storefront after checkout keeps the recovery). Non-empty → `open` with
 * a fresh `updated_at`; `reminded_at` is kept on an open cart and reset when a recovered or cleared
 * cart is reopened, so each new abandoned cart can get its own reminder. A non-empty save within
 * 2 minutes of the recovering order is ignored (a late debounced PUT from the old cart).
 */
export async function saveCart(businessId: string, customerId: string, lines: CartLine[]): Promise<void> {
  const clean = validLines(lines);
  const status = clean.length ? 'open' : 'cleared';
  await query(
    `INSERT INTO store_carts (business_id, customer_id, items, subtotal, status, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, now())
     ON CONFLICT (business_id, customer_id) DO UPDATE SET
       items = EXCLUDED.items,
       subtotal = EXCLUDED.subtotal,
       status = CASE WHEN EXCLUDED.status = 'cleared' AND store_carts.status = 'recovered'
                     THEN 'recovered' ELSE EXCLUDED.status END,
       reminded_at = CASE WHEN EXCLUDED.status = 'open' AND store_carts.status <> 'open'
                          THEN NULL ELSE store_carts.reminded_at END,
       reminder_via = CASE WHEN EXCLUDED.status = 'open' AND store_carts.status <> 'open'
                           THEN NULL ELSE store_carts.reminder_via END,
       recovered_order_id = CASE WHEN EXCLUDED.status = 'open' AND store_carts.status <> 'open'
                                 THEN NULL ELSE store_carts.recovered_order_id END,
       updated_at = now()
     -- A debounced save that lands just after checkout must not reopen the recovered cart.
     WHERE NOT (EXCLUDED.status = 'open' AND store_carts.status = 'recovered' AND EXISTS (
       SELECT 1 FROM store_orders o
        WHERE o.id = store_carts.recovered_order_id AND o.created_at > now() - interval '2 minutes'))`,
    [businessId, customerId, JSON.stringify(clean), cartSubtotal(clean), status],
  );
}

/** The shopper's open cart lines; a cleared or recovered cart reads as empty. */
export async function readCart(businessId: string, customerId: string): Promise<CartLine[]> {
  const row = await queryOne<{ items: CartLine[] }>(
    `SELECT items FROM store_carts WHERE business_id = $1 AND customer_id = $2 AND status = 'open'`,
    [businessId, customerId],
  );
  return Array.isArray(row?.items) ? row.items : [];
}

/** Called inside the checkout transaction once the order row exists. */
export async function markRecovered(
  client: PoolClient,
  businessId: string,
  customerId: string,
  orderId: string,
): Promise<void> {
  await client.query(
    `UPDATE store_carts SET status = 'recovered', recovered_order_id = $3, updated_at = now()
      WHERE business_id = $1 AND customer_id = $2 AND status = 'open'`,
    [businessId, customerId, orderId],
  );
}

type DueRow = {
  id: string;
  business_id: string;
  customer_id: string;
  items: CartLine[];
  subtotal: string;
  phone: string;
  customer_name: string | null;
  store_name: string | null;
  store_subdomain: string;
};

const toDueCart = (r: DueRow): DueCart => ({
  id: r.id,
  businessId: r.business_id,
  customerId: r.customer_id,
  phone: r.phone,
  customerName: r.customer_name?.trim() || 'there',
  storeName: r.store_name?.trim() || 'our store',
  storeSubdomain: r.store_subdomain,
  lines: Array.isArray(r.items) ? r.items : [],
  subtotal: Number(r.subtotal),
});

/**
 * Claims carts due an automatic reminder and stamps `reminded_at` in the same statement, so two
 * cron runs never claim one cart. Due: reminders on for a live store, open, not reminded, not
 * empty, older than the business's delay, and no store order by that shopper since leaving it.
 */
export async function claimDueCarts(limit = 50): Promise<DueCart[]> {
  const r = await query<DueRow>(
    `WITH due AS (
       SELECT c.id
         FROM store_carts c
         JOIN business_settings bs ON bs.business_id = c.business_id
        WHERE bs.store_cart_reminder_enabled
          AND bs.store_enabled
          AND bs.store_subdomain IS NOT NULL
          AND c.status = 'open'
          AND c.reminded_at IS NULL
          AND c.items <> '[]'::jsonb
          AND c.updated_at < now() - make_interval(hours => bs.store_cart_reminder_hours::int)
          AND NOT EXISTS (
            SELECT 1 FROM store_orders o
             WHERE o.business_id = c.business_id
               AND o.store_customer_id = c.customer_id
               AND o.created_at > c.updated_at
          )
        ORDER BY c.updated_at
        LIMIT $1
        FOR UPDATE OF c SKIP LOCKED
     ), claimed AS (
       UPDATE store_carts s SET reminded_at = now()
         FROM due WHERE s.id = due.id
       RETURNING s.id, s.business_id, s.customer_id, s.items, s.subtotal
     )
     SELECT cl.id, cl.business_id, cl.customer_id, cl.items, cl.subtotal::text,
            sc.phone, sc.name AS customer_name, b.name AS store_name, bs.store_subdomain
       FROM claimed cl
       JOIN store_customers sc ON sc.id = cl.customer_id AND sc.business_id = cl.business_id
       JOIN businesses b ON b.id = cl.business_id
       JOIN business_settings bs ON bs.business_id = cl.business_id`,
    [limit],
  );
  return r.rows.map(toDueCart);
}

/**
 * Manual reminder: loads the cart for this business only, enforces the 24 h gap and stamps
 * `reminded_at` under a row lock so two clicks cannot both send.
 */
async function claimManual(
  cartId: string,
  businessId: string,
): Promise<{ cart: DueCart } | { error: 'not_found' | 'store_disabled' | 'too_soon' | 'empty' }> {
  const c = await getPool().connect();
  try {
    await c.query('BEGIN');
    const r = await c.query<DueRow & { reminded_at: Date | null; status: string; store_enabled: boolean | null }>(
      `SELECT s.id, s.business_id, s.customer_id, s.items, s.subtotal::text, s.reminded_at, s.status,
              sc.phone, sc.name AS customer_name, b.name AS store_name, bs.store_subdomain, bs.store_enabled
         FROM store_carts s
         JOIN store_customers sc ON sc.id = s.customer_id AND sc.business_id = s.business_id
         JOIN businesses b ON b.id = s.business_id
         LEFT JOIN business_settings bs ON bs.business_id = s.business_id
        WHERE s.id = $1 AND s.business_id = $2
        FOR UPDATE OF s`,
      [cartId, businessId],
    );
    const row = r.rows[0];
    let error: 'not_found' | 'store_disabled' | 'too_soon' | 'empty' | null = null;
    if (!row) error = 'not_found';
    else if (!row.store_subdomain || !row.store_enabled) error = 'store_disabled';
    else if (row.status !== 'open' || !Array.isArray(row.items) || row.items.length === 0) error = 'empty';
    else if (!canRemindManually(row.reminded_at ? new Date(row.reminded_at) : null, new Date())) error = 'too_soon';
    if (error) {
      await c.query('ROLLBACK');
      return { error };
    }
    await c.query(`UPDATE store_carts SET reminded_at = now(), reminder_via = 'manual' WHERE id = $1`, [cartId]);
    await c.query('COMMIT');
    return { cart: toDueCart(row) };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Sends one reminder over ONE channel: a push when the shopper has a device for this shop
 * (`enqueueCustomerPush` queued it), otherwise WhatsApp. WhatsApp goes through `notifyBusinessEvent`,
 * which itself tries `enqueueCustomerPush` first; we only get there after the same lookup found no
 * device (or no phone), so that inner attempt finds none either and queues nothing. A push lookup
 * that errored does not fall back to WhatsApp, so a transient DB error can never become two
 * messages. `reminded_at` is already set by the claim, so a failed send is logged and not retried.
 */
export async function sendCartReminder(
  cart: DueCart | { id: string; businessId: string },
  via: 'auto' | 'manual',
): Promise<CartReminderResult> {
  let due: DueCart;
  if ('lines' in cart) {
    due = cart;
  } else {
    if (via !== 'manual') return { sent: false, channel: null, error: 'not_claimed' };
    const claimed = await claimManual(cart.id, cart.businessId);
    if ('error' in claimed) return { sent: false, channel: null, error: claimed.error };
    due = claimed.cart;
  }

  let channel: 'push' | 'whatsapp' | null = null;
  let error: string | undefined;
  try {
    // A stored row is re-checked: a corrupt line is logged and skipped, never thrown into the batch.
    const lines = validLines(due.lines);
    if (!lines.length) throw new CartError('bad_line');
    const msg = cartReminderMessage(lines, { name: due.storeName }, due.subtotal);
    const link = cartLink(due.storeSubdomain);
    const push = await enqueueCustomerPush({
      businessId: due.businessId,
      phone: due.phone,
      eventKey: 'store_cart_reminder',
      body: cartPushBody(lines, due.storeName, due.subtotal),
      href: '/cart',
    });
    if (push.queued) {
      channel = 'push';
    } else if (push.reason === 'error') {
      error = 'push_lookup_failed';
    } else {
      const wa = await notifyStoreEvent({
        businessId: due.businessId,
        eventKey: 'store_cart_reminder',
        phone: due.phone,
        values: {
          customer_name: due.customerName,
          store_name: due.storeName,
          item_names: msg.item_names,
          total: msg.total,
          cart_link: link,
        },
        text:
          `Hi ${due.customerName}, you left ${msg.item_names} in your cart at ${due.storeName}. ` +
          `Total ₹${msg.total}. Finish your order here: ${link}`,
      });
      if (wa?.via) channel = 'whatsapp';
      else error = 'whatsapp_not_delivered';
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (error) console.warn(`[abandoned cart] reminder for cart ${due.id} not delivered: ${error}`);

  const recorded = via === 'manual' ? 'manual' : channel;
  if (recorded) {
    await query(`UPDATE store_carts SET reminder_via = $2 WHERE id = $1`, [due.id, recorded]).catch((err) =>
      console.warn(`[abandoned cart] reminder_via not saved for cart ${due.id}:`, err instanceof Error ? err.message : err),
    );
  }
  return error ? { sent: false, channel: null, error } : { sent: true, channel };
}

/** Deletes open or cleared carts untouched for 30 days; recovered carts stay for the report. */
export async function purgeStaleCarts(): Promise<number> {
  const r = await query(
    `DELETE FROM store_carts WHERE status IN ('open', 'cleared') AND updated_at < now() - interval '30 days'`,
  );
  return r.rowCount ?? 0;
}

export type OpenCartRow = {
  id: string;
  customer_name: string | null;
  phone: string;
  item_count: number;
  subtotal: number;
  updated_at: string;
  reminded_at: string | null;
  reminder_via: string | null;
  lines: CartLine[];
};

/** Open carts for the admin page: this business only, newest activity first. */
export async function listOpenCarts(businessId: string, limit = 100): Promise<OpenCartRow[]> {
  const r = await query<{
    id: string;
    items: CartLine[];
    subtotal: string;
    updated_at: Date;
    reminded_at: Date | null;
    reminder_via: string | null;
    customer_name: string | null;
    phone: string;
  }>(
    `SELECT c.id, c.items, c.subtotal::text, c.updated_at, c.reminded_at, c.reminder_via,
            sc.name AS customer_name, sc.phone
       FROM store_carts c
       JOIN store_customers sc ON sc.id = c.customer_id AND sc.business_id = c.business_id
      WHERE c.business_id = $1 AND c.status = 'open' AND c.items <> '[]'::jsonb
      ORDER BY c.updated_at DESC
      LIMIT $2`,
    [businessId, Math.min(Math.max(1, Math.floor(limit)), 100)],
  );
  return r.rows.map((row) => {
    const lines = Array.isArray(row.items) ? row.items : [];
    return {
      id: row.id,
      customer_name: row.customer_name?.trim() || null,
      phone: row.phone,
      item_count: lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0),
      subtotal: Number(row.subtotal),
      updated_at: new Date(row.updated_at).toISOString(),
      reminded_at: row.reminded_at ? new Date(row.reminded_at).toISOString() : null,
      reminder_via: row.reminder_via,
      lines,
    };
  });
}
