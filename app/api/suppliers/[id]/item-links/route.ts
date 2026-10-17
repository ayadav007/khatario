import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { saveItemLink, suggestBuyerItems } from '@/lib/supplier-item-links';

export const dynamic = 'force-dynamic';

const MAX_UNMATCHED = 50;

async function loadLinkedSupplier(supplierId: string, businessId: string) {
  return db.queryOne<{ id: string; name: string; linked_business_id: string | null; approval_status: string }>(
    `SELECT id, name, linked_business_id, approval_status
       FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [supplierId, businessId]
  );
}

/**
 * GET /api/suppliers/[id]/item-links
 * The caller's item map for a linked supplier: saved matches, plus supplier items the caller
 * has already seen (on that supplier's bills to them, their requests, or the supplier's
 * published catalog) that are not matched yet, each with suggested own items.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'items', 'read', { businessId: auth.businessId });
    const supplier = await loadLinkedSupplier(params.id, auth.businessId);
    if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    if (!supplier.linked_business_id) {
      return NextResponse.json({ error: 'This supplier is not on Khatario', code: 'NOT_LINKED' }, { status: 400 });
    }
    const vendorId = supplier.linked_business_id;

    const links = await db.queryRows(
      `
      SELECT l.id, l.vendor_item_id, vi.name AS vendor_item_name, vi.unit AS vendor_unit,
             l.buyer_item_id, bi.name AS buyer_item_name, bi.unit AS buyer_unit,
             l.buyer_units_per_vendor_unit AS factor, l.source, l.last_rate, l.last_used_at
      FROM supplier_item_links l
      JOIN items vi ON vi.id = l.vendor_item_id
      JOIN items bi ON bi.id = l.buyer_item_id AND bi.deleted_at IS NULL
      WHERE l.buyer_business_id = $1 AND l.vendor_business_id = $2
      ORDER BY l.last_used_at DESC NULLS LAST, vi.name
      `,
      [auth.businessId, vendorId]
    );

    const seen = await db.queryRows<{
      vendor_item_id: string;
      name: string;
      unit: string | null;
      hsn_sac: string | null;
      barcode: string | null;
      last_rate: string | null;
    }>(
      `
      WITH seen AS (
        -- lines on the supplier's bills to the caller
        SELECT ii.item_id AS vendor_item_id, ii.unit_price AS rate, inv.invoice_date AS seen_on
        FROM invoices inv
        JOIN invoice_items ii ON ii.invoice_id = inv.id
        JOIN customers c ON c.id = inv.customer_id AND c.business_id = inv.business_id
        WHERE inv.business_id = $2 AND c.linked_business_id = $1
          AND inv.deleted_at IS NULL AND COALESCE(inv.status, '') NOT IN ('draft', 'cancelled')
          AND ii.item_id IS NOT NULL
        UNION ALL
        -- the supplier's item on the caller's quantity requests
        SELECT qr.responder_item_id, NULL, qr.updated_at::date
        FROM quantity_requests qr
        WHERE qr.responder_item_id IS NOT NULL
          AND ((qr.requester_business_id = $1 AND qr.responder_business_id = $2)
            OR (qr.requester_business_id = $2 AND qr.responder_business_id = $1))
        UNION ALL
        -- the supplier's published catalog
        SELECT l.item_id, l.from_amount, l.updated_at::date
        FROM supplier_published_listings l
        WHERE l.supplier_business_id = $2 AND l.is_active = true
      ),
      latest AS (
        SELECT DISTINCT ON (vendor_item_id) vendor_item_id, rate
        FROM seen
        ORDER BY vendor_item_id, seen_on DESC NULLS LAST
      )
      SELECT vi.id AS vendor_item_id, vi.name, vi.unit, vi.hsn_sac, vi.barcode, latest.rate AS last_rate
      FROM latest
      JOIN items vi ON vi.id = latest.vendor_item_id AND vi.business_id = $2 AND vi.deleted_at IS NULL
      WHERE COALESCE(vi.item_type, 'goods') <> 'service'
        AND NOT EXISTS (
          SELECT 1 FROM supplier_item_links l
          WHERE l.buyer_business_id = $1 AND l.vendor_business_id = $2 AND l.vendor_item_id = vi.id
        )
      ORDER BY vi.name
      LIMIT ${MAX_UNMATCHED}
      `,
      [auth.businessId, vendorId]
    );

    const unmatched = [];
    for (const v of seen) {
      unmatched.push({
        vendor_item_id: v.vendor_item_id,
        vendor_item_name: v.name,
        vendor_unit: v.unit,
        last_rate: v.last_rate,
        suggestions: await suggestBuyerItems(auth.businessId, { name: v.name, hsn: v.hsn_sac, barcode: v.barcode }),
      });
    }

    return NextResponse.json({
      supplier: { id: supplier.id, name: supplier.name, status: supplier.approval_status },
      links,
      unmatched,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('supplier item-links GET', error);
    return NextResponse.json({ error: 'Failed to load the item map' }, { status: 500 });
  }
}

/**
 * POST /api/suppliers/[id]/item-links
 * Body: { vendor_item_id, buyer_item_id, factor? }  factor = own units per supplier unit.
 * Saves a hand-set match, which learned matches never overwrite.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'items', 'update', { businessId: auth.businessId });
    const supplier = await loadLinkedSupplier(params.id, auth.businessId);
    if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    if (!supplier.linked_business_id || supplier.approval_status !== 'approved') {
      return NextResponse.json({ error: 'Connect with this supplier first', code: 'NOT_LINKED' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const vendorItemId = String(body.vendor_item_id || '');
    const buyerItemId = String(body.buyer_item_id || '');
    const factor = body.factor == null || body.factor === '' ? 1 : Number(body.factor);
    if (!vendorItemId || !buyerItemId) {
      return NextResponse.json({ error: 'vendor_item_id and buyer_item_id are required' }, { status: 400 });
    }
    if (!(factor > 0)) {
      return NextResponse.json({ error: 'Units per supplier unit must be more than zero' }, { status: 400 });
    }

    const [own, theirs] = await Promise.all([
      db.queryOne(
        `SELECT 1 FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
           AND COALESCE(item_type, 'goods') <> 'service'`,
        [buyerItemId, auth.businessId]
      ),
      db.queryOne(`SELECT 1 FROM items WHERE id = $1 AND business_id = $2`, [vendorItemId, supplier.linked_business_id]),
    ]);
    if (!own) return NextResponse.json({ error: 'Item not found in your items' }, { status: 400 });
    if (!theirs) return NextResponse.json({ error: "Not one of this supplier's items" }, { status: 400 });

    await saveItemLink({
      buyerBusinessId: auth.businessId,
      vendorBusinessId: supplier.linked_business_id,
      buyerItemId,
      vendorItemId,
      factor,
      source: 'manual',
      userId: auth.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('supplier item-links POST', error);
    return NextResponse.json({ error: 'Failed to save the match' }, { status: 500 });
  }
}

/** DELETE /api/suppliers/[id]/item-links?link_id= — forget one match. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'items', 'update', { businessId: auth.businessId });
    const supplier = await loadLinkedSupplier(params.id, auth.businessId);
    if (!supplier?.linked_business_id) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

    const linkId = new URL(request.url).searchParams.get('link_id');
    if (!linkId) return NextResponse.json({ error: 'link_id is required' }, { status: 400 });
    const res = await db.query(
      `DELETE FROM supplier_item_links
        WHERE id = $1 AND buyer_business_id = $2 AND vendor_business_id = $3`,
      [linkId, auth.businessId, supplier.linked_business_id]
    );
    if (!res.rowCount) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('supplier item-links DELETE', error);
    return NextResponse.json({ error: 'Failed to remove the match' }, { status: 500 });
  }
}
