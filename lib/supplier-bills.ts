/**
 * Supplier Hub: a connected supplier's sales invoice seen from the buyer's side.
 *
 * Used by the incoming-bills inbox, the receive screen and the invoice-to-purchase converter,
 * so all three agree on which bills a buyer may see and how each line maps to the buyer's items.
 */

import type { PoolClient } from 'pg';
import { partiesFromItemOwner } from './quantity-request-parties';
import { loadItemLinks, suggestBuyerItems, type ItemSuggestion } from './supplier-item-links';

/**
 * SQL condition: invoice `inv` (issued by a business the buyer has an approved link to) is
 * addressed to buyer $1 — its customer record is linked to the buyer, its recipient GSTIN is
 * one of the buyer's registrations, or it fulfils one of the buyer's quantity requests.
 */
export const BILL_ADDRESSED_TO_BUYER_SQL = `
  EXISTS (
    SELECT 1 FROM suppliers s
    WHERE s.business_id = $1
      AND s.linked_business_id = inv.business_id
      AND s.approval_status = 'approved'
      AND s.deleted_at IS NULL
  )
  AND (
    EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = inv.customer_id AND c.business_id = inv.business_id AND c.linked_business_id = $1
    )
    OR (
      NULLIF(UPPER(TRIM(inv.customer_gstin)), '') IS NOT NULL
      AND (
        EXISTS (SELECT 1 FROM businesses b WHERE b.id = $1 AND UPPER(TRIM(b.gstin)) = UPPER(TRIM(inv.customer_gstin)))
        OR EXISTS (SELECT 1 FROM branches br WHERE br.business_id = $1 AND UPPER(TRIM(br.gstin)) = UPPER(TRIM(inv.customer_gstin)))
      )
    )
    OR EXISTS (
      SELECT 1 FROM quantity_requests qr
      JOIN items qi ON qi.id = qr.item_id
      WHERE qr.invoice_id = inv.id AND qi.business_id = $1
    )
  )
  AND inv.business_id <> $1
  AND inv.deleted_at IS NULL
  AND COALESCE(inv.status, '') NOT IN ('draft', 'cancelled')
  AND COALESCE(inv.document_type, '') <> 'proforma_invoice'
`;

export type LinkedRequest = {
  id: string;
  requester_business_id: string;
  responder_business_id: string;
  item_id: string;
  responder_item_id: string | null;
  item_business_id: string;
};

export type BillAccess =
  | { ok: true; invoice: any; supplierId: string; linkedRequests: LinkedRequest[]; reason: string }
  | { ok: false; status: number; error: string };

/** Load a supplier's invoice for the buyer, or say why the buyer may not see it. */
export async function loadBillForBuyer(
  client: PoolClient,
  invoiceId: string,
  buyerBusinessId: string
): Promise<BillAccess> {
  const invoiceRes = await client.query(
    `
    SELECT i.*,
      b.id AS supplier_business_id,
      b.name AS supplier_business_name,
      b.state AS supplier_state,
      b.state_code AS supplier_state_code,
      b.gstin AS supplier_gstin
    FROM invoices i
    LEFT JOIN businesses b ON i.business_id = b.id
    WHERE i.id = $1
      AND i.deleted_at IS NULL
      AND COALESCE(i.status, '') NOT IN ('draft', 'cancelled')
      AND COALESCE(i.document_type, '') <> 'proforma_invoice'
    `,
    [invoiceId]
  );
  const invoice = invoiceRes.rows[0];
  if (!invoice || invoice.business_id === buyerBusinessId) {
    return { ok: false, status: 404, error: 'Invoice not found' };
  }

  // The buyer must have an approved link to the issuing business...
  const supplierRes = await client.query(
    `SELECT id FROM suppliers
      WHERE business_id = $1 AND linked_business_id = $2
        AND approval_status = 'approved' AND deleted_at IS NULL
      LIMIT 1`,
    [buyerBusinessId, invoice.business_id]
  );
  const supplierId: string | null = supplierRes.rows[0]?.id ?? null;

  // ...and the invoice must be addressed to the buyer.
  const requestRes = await client.query(
    `SELECT qr.id, qr.requester_business_id, qr.responder_business_id, qr.item_id,
            qr.responder_item_id, i.business_id AS item_business_id
       FROM quantity_requests qr
       JOIN items i ON i.id = qr.item_id
      WHERE qr.invoice_id = $1`,
    [invoiceId]
  );
  const linkedRequests: LinkedRequest[] = requestRes.rows.filter((r: any) => {
    const parties = partiesFromItemOwner(r.requester_business_id, r.responder_business_id, r.item_business_id, r.item_id);
    return parties?.buyerBusinessId === buyerBusinessId && parties.vendorBusinessId === invoice.business_id;
  });

  let reason = linkedRequests.length > 0 ? 'linked to request' : '';
  if (!reason && invoice.customer_id) {
    const linked = await client.query(
      `SELECT 1 FROM customers WHERE id = $1 AND business_id = $2 AND linked_business_id = $3`,
      [invoice.customer_id, invoice.business_id, buyerBusinessId]
    );
    if (linked.rows.length > 0) reason = 'linked customer';
  }
  const recipientGstin = String(invoice.customer_gstin || '').trim().toUpperCase();
  if (!reason && recipientGstin) {
    const gstinRes = await client.query(
      `SELECT 1 FROM businesses WHERE id = $1 AND UPPER(TRIM(gstin)) = $2
       UNION ALL
       SELECT 1 FROM branches WHERE business_id = $1 AND UPPER(TRIM(gstin)) = $2
       LIMIT 1`,
      [buyerBusinessId, recipientGstin]
    );
    if (gstinRes.rows.length > 0) reason = 'recipient GSTIN';
  }

  if (!supplierId) {
    return { ok: false, status: 403, error: 'The issuing business is not an approved linked supplier of yours' };
  }
  if (!reason) return { ok: false, status: 403, error: 'This invoice is not addressed to your business' };
  return { ok: true, invoice, supplierId, linkedRequests, reason };
}

/** The supplier's invoice lines with the supplier item's type and barcode. */
export async function loadBillLines(client: PoolClient, invoiceId: string): Promise<any[]> {
  const res = await client.query(
    `SELECT ii.*, COALESCE(vi.item_type, 'goods') AS vendor_item_type, vi.barcode AS vendor_barcode,
            vi.tax_rate AS vendor_tax_rate, vi.image_url AS vendor_image_url
       FROM invoice_items ii
       LEFT JOIN items vi ON vi.id = ii.item_id
      WHERE ii.invoice_id = $1
      ORDER BY ii.sort_order ASC`,
    [invoiceId]
  );
  return res.rows;
}

export type ItemChoice = { itemId: string; factor: number | null };

/**
 * Parse body.item_map: { [invoice_item_id]: own item id | { item_id, factor } }, where factor is
 * own units per supplier unit. Returns an error message for a bad factor.
 */
export function parseItemMap(raw: unknown): { map: Map<string, ItemChoice> } | { error: string } {
  const map = new Map<string, ItemChoice>();
  if (!raw || typeof raw !== 'object') return { map };
  for (const [lineId, v] of Object.entries(raw as Record<string, unknown>)) {
    const asObject = typeof v === 'object' && v ? (v as { item_id?: unknown; factor?: unknown }) : null;
    const itemId = typeof v === 'string' ? v : asObject?.item_id;
    if (!itemId) continue;
    const factor = asObject?.factor != null && asObject.factor !== '' ? Number(asObject.factor) : null;
    if (factor != null && !(factor > 0)) return { error: 'Units per supplier unit must be more than zero' };
    map.set(String(lineId), { itemId: String(itemId), factor });
  }
  return { map };
}

export type ResolvedLine = {
  itemId: string | null;
  itemName: string | null;
  unit: string | null;
  factor: number;
  /** How to remember this match: a person chose it, it was learned, or it came from the saved map. */
  learnedFrom: 'manual' | 'conversion' | null;
};

export type UnmatchedLine = {
  invoice_item_id: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  suggestions: ItemSuggestion[];
};

/**
 * Map each supplier line to the buyer's own item and unit. Order: the buyer's choice → the saved
 * item map → the item on a linked quantity request → an exact name match. Goods lines left over
 * come back as unmatched with suggestions.
 */
export async function resolveBillLines(
  client: PoolClient,
  p: {
    buyerBusinessId: string;
    vendorBusinessId: string;
    lines: any[];
    linkedRequests: LinkedRequest[];
    choices: Map<string, ItemChoice>;
    withSuggestions?: boolean;
  }
): Promise<{ ok: true; resolved: ResolvedLine[]; unmatched: UnmatchedLine[] } | { ok: false; error: string }> {
  const { buyerBusinessId, lines, linkedRequests, choices } = p;
  const savedLinks = await loadItemLinks(
    buyerBusinessId,
    p.vendorBusinessId,
    lines.map((l) => l.item_id).filter(Boolean).map(String),
    client
  );
  const requestMap = new Map<string, string>();
  for (const r of linkedRequests) {
    if (r.responder_item_id) requestMap.set(String(r.responder_item_id), String(r.item_id));
  }
  const ownIds = Array.from(
    new Set([
      ...Array.from(choices.values()).map((c) => c.itemId),
      ...Array.from(requestMap.values()),
      ...Array.from(savedLinks.values()).map((l) => l.buyerItemId),
    ])
  );
  const own = new Map<string, { id: string; name: string; unit: string | null }>();
  if (ownIds.length > 0) {
    const res = await client.query(
      `SELECT id, name, unit FROM items WHERE business_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
      [buyerBusinessId, ownIds]
    );
    for (const r of res.rows) own.set(String(r.id), { id: String(r.id), name: r.name, unit: r.unit });
  }

  const resolved: ResolvedLine[] = [];
  const unmatched: UnmatchedLine[] = [];
  for (const line of lines) {
    let r: ResolvedLine | null = null;
    const choice = choices.get(String(line.id));
    const saved = line.item_id ? savedLinks.get(String(line.item_id)) : undefined;
    if (choice) {
      const item = own.get(choice.itemId);
      if (!item) return { ok: false, error: `Item chosen for "${line.item_name}" was not found in your items` };
      const savedFactor = saved && saved.buyerItemId === item.id ? saved.factor : 1;
      r = { itemId: item.id, itemName: item.name, unit: item.unit, factor: choice.factor ?? savedFactor, learnedFrom: 'manual' };
    }
    if (!r && saved) {
      const item = own.get(saved.buyerItemId);
      r = { itemId: saved.buyerItemId, itemName: item?.name ?? null, unit: saved.buyerUnit, factor: saved.factor, learnedFrom: null };
    }
    if (!r && line.item_id && requestMap.has(String(line.item_id))) {
      const item = own.get(requestMap.get(String(line.item_id))!);
      if (item) r = { itemId: item.id, itemName: item.name, unit: item.unit, factor: 1, learnedFrom: 'conversion' };
    }
    if (!r && line.item_name) {
      const byName = await client.query(
        `SELECT id, name, unit FROM items
          WHERE business_id = $1 AND deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM($2))
          LIMIT 1`,
        [buyerBusinessId, line.item_name]
      );
      const m = byName.rows[0];
      if (m) r = { itemId: String(m.id), itemName: m.name, unit: m.unit, factor: 1, learnedFrom: 'conversion' };
    }
    if (!r && line.vendor_item_type !== 'service') {
      unmatched.push({
        invoice_item_id: String(line.id),
        item_name: line.item_name,
        quantity: Number(line.quantity) || 0,
        unit: line.unit ?? null,
        suggestions:
          p.withSuggestions === false
            ? []
            : await suggestBuyerItems(
                buyerBusinessId,
                { name: line.item_name, hsn: line.hsn_sac, barcode: line.vendor_barcode },
                client
              ),
      });
    }
    resolved.push(r ?? { itemId: null, itemName: null, unit: null, factor: 1, learnedFrom: null });
  }
  return { ok: true, resolved, unmatched };
}

/** Quantity and rate of a supplier line in the buyer's unit (value and tax stay as billed). */
export function inBuyerUnits(line: { quantity: unknown; unit_price: unknown }, factor: number) {
  const f = factor > 0 ? factor : 1;
  return {
    qty: Math.round((Number(line.quantity) || 0) * f * 10000) / 10000,
    rate: Math.round(((Number(line.unit_price) || 0) / f) * 10000) / 10000,
  };
}
