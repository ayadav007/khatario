import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { loadBillForBuyer, loadBillLines } from '@/lib/supplier-bills';
import { saveItemLink } from '@/lib/supplier-item-links';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchases/incoming-bills/[invoiceId]/create-item
 * Body: { invoice_item_id, name?, unit?, factor?, selling_price? }
 * Creates the buyer's own item from a connected supplier's bill line (a new design or model the
 * buyer has never stocked) and remembers the match. Name, HSN, tax rate and unit come from the
 * line unless given; cost is the supplier's rate per buyer unit (rate / factor).
 */
export async function POST(request: NextRequest, { params }: { params: { invoiceId: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  const client = await db.getPool().connect();
  try {
    await authorize(auth.userId, 'items', 'create', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    const lineId = String(body.invoice_item_id || '');
    if (!lineId) return NextResponse.json({ error: 'invoice_item_id is required' }, { status: 400 });

    const factor = body.factor == null || body.factor === '' ? 1 : Number(body.factor);
    if (!(factor > 0)) {
      return NextResponse.json({ error: 'Units per supplier unit must be more than zero' }, { status: 400 });
    }
    const sellingPrice = body.selling_price == null || body.selling_price === '' ? null : Number(body.selling_price);
    if (sellingPrice != null && !(sellingPrice >= 0)) {
      return NextResponse.json({ error: 'Selling price must be zero or more' }, { status: 400 });
    }

    const access = await loadBillForBuyer(client, params.invoiceId, auth.businessId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const { invoice } = access;

    const line = (await loadBillLines(client, params.invoiceId)).find((l) => String(l.id) === lineId);
    if (!line) return NextResponse.json({ error: 'Line not found on this bill' }, { status: 404 });
    if (line.vendor_item_type === 'service') {
      return NextResponse.json({ error: 'Services are not stocked' }, { status: 400 });
    }

    const name = String(body.name || line.item_name || '').trim().slice(0, 255);
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    const unit = String(body.unit || (factor === 1 ? line.unit : '') || 'PCS').trim().slice(0, 20);
    const cost = Math.round(((Number(line.unit_price) || 0) / factor) * 100) / 100;

    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO items (
         business_id, name, unit, selling_price, purchase_price, tax_rate, hsn_sac,
         item_type, opening_stock, current_stock, min_stock, default_supplier_id, is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'goods', 0, 0, 0, $8, true)
       RETURNING id, name, unit, purchase_price, selling_price, tax_rate, hsn_sac`,
      [
        auth.businessId,
        name,
        unit,
        sellingPrice,
        cost,
        Number(line.tax_rate ?? line.vendor_tax_rate) || 0,
        line.hsn_sac || null,
        access.supplierId,
      ]
    );
    const item = created.rows[0];
    if (line.item_id) {
      await saveItemLink(
        {
          buyerBusinessId: auth.businessId,
          vendorBusinessId: invoice.business_id,
          buyerItemId: item.id,
          vendorItemId: String(line.item_id),
          factor,
          source: 'manual',
          rate: Number(line.unit_price) || null,
          userId: auth.userId,
        },
        client
      );
    }
    await client.query('COMMIT');
    return NextResponse.json({ item, factor }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof AuthorizationError) return error.toNextResponse();
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'An item with this name or code already exists' }, { status: 409 });
    }
    console.error('incoming-bill create-item', error);
    return NextResponse.json({ error: 'Failed to create the item' }, { status: 500 });
  } finally {
    client.release();
  }
}
