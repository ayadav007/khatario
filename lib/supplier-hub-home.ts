/**
 * Supplier Hub home: everything waiting on one business, as buyer and as supplier, in one list,
 * plus the counts behind the Buying and Selling shortcuts.
 *
 * Each inbox item carries the one action that clears it, so the home screen can act without
 * opening another page where that is safe (confirm a proposal as is, send a suggested draft,
 * answer a connection request) and links straight to the right screen where it is not.
 */

import type { PoolClient } from 'pg';
import { execFor } from './supplier-hub-links';
import { listIncomingBills } from './supplier-bills';
import { BUYER_LINE_PRICE_SQL, LISTING_FOR_LINE_SQL, listSupplyOrders } from './supply-orders';

export type InboxAction =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'order'; label: string; orderId: string; orderAction: 'confirm' | 'send' }
  | { kind: 'request'; requestId: string }
  | { kind: 'money'; label: string; noticeId: string }
  | { kind: 'standing'; standingId: string };

export type InboxKind =
  | 'connection_request'
  | 'order_to_answer'
  | 'order_to_confirm'
  | 'bill_to_receive'
  | 'ready_to_bill'
  | 'draft_to_send'
  | 'payment_to_record'
  | 'credit_note_to_issue'
  | 'standing_to_accept';

export type InboxItem = {
  key: string;
  kind: InboxKind;
  side: 'buying' | 'selling';
  partner: string;
  title: string;
  detail: string;
  /** Rupees; `approx` when it is an estimate from catalog or list prices. */
  amount: number | null;
  approx: boolean;
  at: string;
  /** Where "Open" goes: the full screen for this item. */
  href: string;
  action: InboxAction;
};

export type HubHome = {
  roles: { buying: boolean; selling: boolean };
  inbox: InboxItem[];
  buying: {
    suppliers: number;
    openOrders: number;
    billsToReceive: number;
    newCollections: number;
    /** Connected suppliers, newest link first: this business's own supplier record for each. */
    partners: { supplierId: string; name: string; city: string | null }[];
  };
  selling: {
    buyers: number;
    buyersSharing: number;
    buyersLow: number;
    openOrders: number;
    catalogItems: number;
    insights: SellerInsights;
  };
};

export type QuietBuyer = {
  buyerBusinessId: string;
  name: string;
  /** This supplier's own customer record for the buyer, for opening it. */
  customerId: string | null;
  lastBilledAt: string | null;
  daysQuiet: number | null;
  sales90: number;
};

export type SellerInsights = {
  /** Share of what shops asked for that was confirmed, over the last 90 days; null without such orders. */
  fillRate: number | null;
  ordersAsked90: number;
  sales90: number;
  /** Connected shops not billed in QUIET_DAYS or more (or never), quietest first. */
  quietBuyers: QuietBuyer[];
};

export const QUIET_DAYS = 30;

/** Fill rate and quiet buyers for a supplier, from its own invoices and orders only. */
export async function loadSellerInsights(businessId: string, client?: PoolClient): Promise<SellerInsights> {
  const exec = execFor(client);
  const [fill, buyers] = await Promise.all([
    exec(
      `SELECT COUNT(DISTINCT o.id)::int AS orders,
              (SUM(LEAST(COALESCE(l.confirmed_qty, 0), l.qty)) / NULLIF(SUM(l.qty), 0))::float8 AS fill
         FROM supply_orders o
         JOIN supply_order_lines l ON l.order_id = o.id
        WHERE o.vendor_business_id = $1
          AND o.origin IN ('buyer', 'catalog')
          AND o.status IN ('confirmed', 'partial', 'invoiced', 'dispatched', 'received')
          AND o.created_at >= NOW() - INTERVAL '90 days'`,
      [businessId]
    ).then((r) => r.rows[0]),
    exec(
      `WITH buyers AS (
         SELECT DISTINCT ON (s.business_id) s.business_id AS buyer_id, b.name
           FROM suppliers s
           JOIN businesses b ON b.id = s.business_id
          WHERE s.linked_business_id = $1 AND s.approval_status = 'approved' AND s.deleted_at IS NULL
          ORDER BY s.business_id, s.approved_at DESC NULLS LAST
       ),
       billed AS (
         SELECT c.linked_business_id AS buyer_id,
                MAX(inv.invoice_date) AS last_billed,
                COALESCE(SUM(inv.grand_total) FILTER (WHERE inv.invoice_date >= CURRENT_DATE - 90), 0) AS sales_90
           FROM invoices inv
           JOIN customers c ON c.id = inv.customer_id AND c.business_id = inv.business_id
          WHERE inv.business_id = $1 AND inv.status = 'final' AND c.linked_business_id IS NOT NULL
          GROUP BY c.linked_business_id
       )
       SELECT bu.buyer_id, bu.name, bi.last_billed, COALESCE(bi.sales_90, 0)::float8 AS sales_90,
              (SELECT c.id FROM customers c
                WHERE c.business_id = $1 AND c.linked_business_id = bu.buyer_id AND c.deleted_at IS NULL
                ORDER BY c.created_at LIMIT 1) AS customer_id,
              (CURRENT_DATE - bi.last_billed::date)::int AS days_quiet
         FROM buyers bu
         LEFT JOIN billed bi ON bi.buyer_id = bu.buyer_id`,
      [businessId]
    ).then((r) => r.rows),
  ]);

  const quietBuyers: QuietBuyer[] = buyers
    .filter((b: any) => b.days_quiet == null || Number(b.days_quiet) >= QUIET_DAYS)
    .map((b: any) => ({
      buyerBusinessId: b.buyer_id,
      name: b.name,
      customerId: b.customer_id || null,
      lastBilledAt: b.last_billed ? new Date(b.last_billed).toISOString() : null,
      daysQuiet: b.days_quiet == null ? null : Number(b.days_quiet),
      sales90: Number(b.sales_90) || 0,
    }))
    // Shops that used to buy and stopped matter most; never-billed ones come after.
    .sort((a, b) => (b.daysQuiet ?? -1) - (a.daysQuiet ?? -1));

  return {
    fillRate: fill?.fill == null ? null : Number(fill.fill),
    ordersAsked90: Number(fill?.orders) || 0,
    sales90: buyers.reduce((n: number, b: any) => n + (Number(b.sales_90) || 0), 0),
    quietBuyers,
  };
}

/** Lower comes first: things another business is waiting on, then money, then suggestions. */
const PRIORITY: Record<InboxKind, number> = {
  connection_request: 0,
  order_to_answer: 0,
  order_to_confirm: 0,
  bill_to_receive: 1,
  ready_to_bill: 1,
  payment_to_record: 1,
  credit_note_to_issue: 1,
  standing_to_accept: 0,
  draft_to_send: 2,
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Order totals per order: the buyer's estimate or the supplier's list value. */
async function orderTotals(exec: ReturnType<typeof execFor>, orderIds: string[], side: 'buyer' | 'vendor') {
  if (orderIds.length === 0) return new Map<string, { total: number; priced: boolean; unmatched: number }>();
  const price = side === 'buyer' ? BUYER_LINE_PRICE_SQL : 'COALESCE(l.unit_price, bp.price, vi.selling_price)';
  const { rows } = await exec(
    `SELECT l.order_id,
            SUM(COALESCE(l.confirmed_qty, l.qty) * ${price})::float8 AS total,
            BOOL_AND(${price} IS NOT NULL) AS priced,
            COUNT(*) FILTER (WHERE l.vendor_item_id IS NULL)::int AS unmatched
       FROM supply_order_lines l
       JOIN supply_orders o ON o.id = l.order_id
       LEFT JOIN items vi ON vi.id = l.vendor_item_id
       ${LISTING_FOR_LINE_SQL('o.vendor_business_id', 'o.buyer_business_id')}
      WHERE l.order_id = ANY($1::uuid[])
      GROUP BY l.order_id`,
    [orderIds]
  );
  return new Map(
    rows.map((r: any) => [
      r.order_id as string,
      { total: Number(r.total) || 0, priced: !!r.priced, unmatched: Number(r.unmatched) || 0 },
    ])
  );
}

export async function loadHubHome(businessId: string, client?: PoolClient): Promise<HubHome> {
  const exec = execFor(client);

  const [counts, bills, buyerAction, vendorAction, buyerOpen, vendorOpen, requests, partners, insights] = await Promise.all([
    exec(
      `SELECT
         (SELECT COUNT(DISTINCT s.linked_business_id)::int FROM suppliers s
           WHERE s.business_id = $1 AND s.linked_business_id IS NOT NULL
             AND s.approval_status = 'approved' AND s.deleted_at IS NULL) AS suppliers,
         (SELECT COUNT(DISTINCT s.business_id)::int FROM suppliers s
           WHERE s.linked_business_id = $1 AND s.approval_status = 'approved' AND s.deleted_at IS NULL) AS buyers,
         (SELECT COUNT(DISTINCT s.business_id)::int FROM suppliers s
           WHERE s.linked_business_id = $1 AND s.approval_status = 'approved' AND s.deleted_at IS NULL
             AND s.allow_low_stock_access = true) AS buyers_sharing,
         (SELECT COUNT(DISTINCT s.business_id)::int FROM suppliers s
           JOIN items i ON i.business_id = s.business_id AND i.default_supplier_id = s.id
          WHERE s.linked_business_id = $1 AND s.approval_status = 'approved' AND s.deleted_at IS NULL
            AND s.allow_low_stock_access = true
            AND i.deleted_at IS NULL AND i.is_active = true
            AND COALESCE(i.min_stock, 0) > 0 AND COALESCE(i.current_stock, 0) <= i.min_stock) AS buyers_low,
         (SELECT COUNT(*)::int FROM supplier_published_listings l
           WHERE l.supplier_business_id = $1 AND l.is_active = true) AS catalog_items,
         (SELECT COUNT(*)::int FROM supplier_collections c
           WHERE c.status = 'published' AND c.published_at >= NOW() - INTERVAL '14 days'
             AND c.supplier_business_id IN (
               SELECT s.linked_business_id FROM suppliers s
                WHERE s.business_id = $1 AND s.approval_status = 'approved'
                  AND s.deleted_at IS NULL AND s.mute_launches = false)) AS new_collections`,
      [businessId]
    ).then((r) => r.rows[0]),
    listIncomingBills(businessId, 'pending', client),
    listSupplyOrders(businessId, 'buyer', 'action', client),
    listSupplyOrders(businessId, 'vendor', 'action', client),
    listSupplyOrders(businessId, 'buyer', 'open', client),
    listSupplyOrders(businessId, 'vendor', 'open', client),
    exec(
      `SELECT r.id, r.created_at, b.name,
              (SELECT COUNT(*)::int FROM supply_order_lines l JOIN supply_orders o ON o.id = l.order_id
                WHERE o.connection_request_id = r.id AND o.status = 'awaiting_link') AS order_lines
         FROM supplier_connection_requests r
         JOIN businesses b ON b.id = r.buyer_business_id
        WHERE r.supplier_business_id = $1 AND r.status = 'pending'
        ORDER BY r.created_at DESC
        LIMIT 50`,
      [businessId]
    ).then((r) => r.rows),
    exec(
      `SELECT DISTINCT ON (s.linked_business_id) s.id, b.name, b.city
         FROM suppliers s
         JOIN businesses b ON b.id = s.linked_business_id
        WHERE s.business_id = $1 AND s.approval_status = 'approved' AND s.deleted_at IS NULL
        ORDER BY s.linked_business_id, s.approved_at DESC NULLS LAST`,
      [businessId]
    ).then((r) => r.rows),
    loadSellerInsights(businessId, client),
  ]);

  // Bills cover orders that are already invoiced, so only proposals wait here for the buyer.
  const proposals = buyerAction.filter((o: any) => o.status === 'proposed');
  // Payments and debit notes connected buyers recorded against this supplier's bills.
  const { listMoneyNotices } = await import('./supplier-hub-money');
  const moneyNotices = await listMoneyNotices(businessId).catch(() => []);
  const { listStandingOrders, weekdaysLabel } = await import('./supply-standing-orders');
  const standingProposals = (await listStandingOrders(businessId, 'vendor').catch(() => [])).filter(
    (s: any) => s.status === 'proposed'
  );

  const [buyerTotals, vendorTotals] = await Promise.all([
    orderTotals(exec, proposals.map((o: any) => o.id), 'buyer'),
    orderTotals(exec, vendorAction.map((o: any) => o.id), 'vendor'),
  ]);

  const inbox: InboxItem[] = [];

  for (const r of requests) {
    inbox.push({
      key: `request-${r.id}`,
      kind: 'connection_request',
      side: 'selling',
      partner: r.name,
      title: `${r.name} wants to connect`,
      detail: r.order_lines
        ? `Their first order of ${plural(r.order_lines, 'item')} from your catalogue comes to you when you accept.`
        : 'They want to buy from you through the Supplier Hub.',
      amount: null,
      approx: false,
      at: new Date(r.created_at).toISOString(),
      href: '/settings/suppliers-directory',
      action: { kind: 'request', requestId: r.id },
    });
  }

  for (const b of bills) {
    inbox.push({
      key: `bill-${b.invoice_id}`,
      kind: 'bill_to_receive',
      side: 'buying',
      partner: b.supplier_name,
      title: `Bill ${b.invoice_number} from ${b.supplier_name}`,
      detail: b.possible_duplicate
        ? 'Looks like a bill you already entered by hand. Check before receiving.'
        : `${plural(Number(b.line_count) || 0, 'item')}. Check what arrived and it becomes your purchase.`,
      amount: Number(b.grand_total) || 0,
      approx: false,
      at: new Date(b.invoice_date).toISOString(),
      href: `/purchases/incoming/${b.invoice_id}`,
      action: { kind: 'link', label: 'Receive', href: `/purchases/incoming/${b.invoice_id}` },
    });
  }

  for (const o of proposals) {
    const t = buyerTotals.get(o.id);
    inbox.push({
      key: `order-${o.id}`,
      kind: 'order_to_confirm',
      side: 'buying',
      partner: o.other_business_name,
      title: `${o.other_business_name} proposed an order`,
      detail: `${plural(o.line_count, 'item')}${o.origin === 'suggested' ? ', from your low stock' : ''}. Confirm as is, or open to change quantities.`,
      amount: t && t.total > 0 ? t.total : null,
      approx: true,
      at: new Date(o.updated_at).toISOString(),
      href: `/supply-orders/${o.id}`,
      action: { kind: 'order', label: 'Confirm', orderId: o.id, orderAction: 'confirm' },
    });
  }

  for (const o of vendorAction) {
    const t = vendorTotals.get(o.id);
    const amount = t && t.total > 0 ? t.total : null;
    const base = {
      side: 'selling' as const,
      partner: o.other_business_name,
      amount,
      approx: false,
      at: new Date(o.updated_at).toISOString(),
      href: `/supply-orders/${o.id}`,
    };
    if (o.status === 'draft') {
      inbox.push({
        ...base,
        key: `order-${o.id}`,
        kind: 'draft_to_send',
        title:
          o.origin === 'suggested'
            ? `${o.other_business_name} is low on ${o.line_count === 1 ? 'one of your items' : `${o.line_count} of your items`}`
            : `Draft order for ${o.other_business_name}`,
        detail: t?.unmatched
          ? `Pick your item for ${t.unmatched === 1 ? 'one line' : `${t.unmatched} lines`}, then send it for them to confirm.`
          : 'Check the quantities, then send it for them to confirm.',
        action: t?.unmatched
          ? { kind: 'link', label: 'Review', href: `/supply-orders/${o.id}` }
          : { kind: 'order', label: 'Send', orderId: o.id, orderAction: 'send' },
      });
    } else if (o.status === 'pending') {
      inbox.push({
        ...base,
        key: `order-${o.id}`,
        kind: 'order_to_answer',
        title:
          o.origin === 'backorder'
            ? `Backorder for ${o.other_business_name}: ${plural(o.line_count, 'item')}`
            : `${o.other_business_name} ordered ${plural(o.line_count, 'item')}`,
        detail:
          o.origin === 'backorder'
            ? 'The rest of an order you partly confirmed. Confirm it when the stock is in.'
            : 'Confirm how much of each you can supply.',
        action: { kind: 'link', label: 'Answer', href: `/supply-orders/${o.id}` },
      });
    } else {
      inbox.push({
        ...base,
        key: `order-${o.id}`,
        kind: 'ready_to_bill',
        title: `Order from ${o.other_business_name} is confirmed`,
        detail: o.status === 'partial' ? 'Partly confirmed. Ready to bill what you can supply.' : 'Ready to bill.',
        action: { kind: 'link', label: 'Create bill', href: `/invoices/new?supply_order_id=${o.id}` },
      });
    }
  }

  for (const s of standingProposals) {
    const lines = (s.lines || []) as Array<{ item_name: string; qty: string }>;
    inbox.push({
      key: `standing-${s.id}`,
      kind: 'standing_to_accept',
      side: 'selling',
      partner: s.other_business_name,
      title: `${s.other_business_name} wants a standing order`,
      detail: `${lines.map((l) => `${l.item_name} ${Number(l.qty)}`).join(', ')}, ${weekdaysLabel(s.weekdays)}.`,
      amount: null,
      approx: false,
      at: new Date(s.created_at).toISOString(),
      href: '/supply-orders',
      action: { kind: 'standing', standingId: s.id },
    });
  }

  for (const n of moneyNotices) {
    const base = {
      key: `money-${n.id}`,
      side: 'selling' as const,
      partner: n.buyer_name,
      amount: n.amount,
      approx: false,
      at: n.created_at,
    };
    if (n.kind === 'payment') {
      inbox.push({
        ...base,
        kind: 'payment_to_record',
        title: `${n.buyer_name} paid for bill ${n.invoice_number || ''}`.trim(),
        detail: `${n.payment_mode ? `By ${n.payment_mode}, ` : ''}${n.happened_on}. Record the receipt so both books agree.`,
        href: `/invoices/${n.invoice_id}`,
        action: { kind: 'money', label: 'Record receipt', noticeId: n.id },
      });
    } else {
      const href = `/credit-notes/new?customer_id=${n.customer_id ?? ''}&invoice_id=${n.invoice_id}`;
      inbox.push({
        ...base,
        kind: 'credit_note_to_issue',
        title: `${n.buyer_name} returned goods from bill ${n.invoice_number || ''}`.trim(),
        detail: `Debit note${n.note ? `: ${n.note}` : ''}. Issue the matching credit note.`,
        href,
        action: { kind: 'link', label: 'Credit note', href },
      });
    }
  }

  inbox.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.at.localeCompare(a.at));

  const suppliers = Number(counts.suppliers) || 0;
  const buyers = Number(counts.buyers) || 0;
  const catalogItems = Number(counts.catalog_items) || 0;
  return {
    roles: {
      buying: suppliers > 0 || buyerOpen.length > 0 || bills.length > 0,
      selling: buyers > 0 || catalogItems > 0 || requests.length > 0 || vendorOpen.length > 0,
    },
    inbox,
    buying: {
      suppliers,
      openOrders: buyerOpen.length,
      billsToReceive: bills.length,
      newCollections: Number(counts.new_collections) || 0,
      partners: partners
        .map((p: any) => ({ supplierId: p.id as string, name: p.name as string, city: (p.city as string) || null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    selling: {
      buyers,
      buyersSharing: Number(counts.buyers_sharing) || 0,
      buyersLow: Number(counts.buyers_low) || 0,
      openOrders: vendorOpen.length,
      catalogItems,
      insights,
    },
  };
}
