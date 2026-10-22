import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { gstRateError } from '@/lib/gst/rates';

export const dynamic = 'force-dynamic';

const TYPES = new Set(['goods', 'service']);

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    try {
      await authorize(session.userId, 'expenses', 'update', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
    const body = await request.json();
    const current = await db.queryOne<{ id: string }>(
      `SELECT id FROM expense_items WHERE id = $1 AND business_id = $2`,
      [params.id, session.businessId]
    );
    if (!current) return NextResponse.json({ error: 'Expense item not found' }, { status: 404 });

    const name = body.name !== undefined ? String(body.name).trim() : undefined;
    if (name !== undefined && !name) {
      return NextResponse.json({ error: 'Item name is required.', code: 'EXPENSE_ITEM_INVALID' }, { status: 400 });
    }
    const itemType = body.item_type !== undefined ? String(body.item_type) : undefined;
    if (itemType !== undefined && !TYPES.has(itemType)) {
      return NextResponse.json({ error: 'Item must be goods or a service.', code: 'EXPENSE_ITEM_INVALID' }, { status: 400 });
    }
    let taxRate: number | undefined;
    if (body.tax_rate !== undefined) {
      const rateError = gstRateError(body.tax_rate);
      if (rateError) return NextResponse.json({ error: rateError, code: 'EXPENSE_ITEM_INVALID' }, { status: 400 });
      taxRate = Number(body.tax_rate);
    }
    const unit = body.unit !== undefined ? String(body.unit).trim().slice(0, 50) || 'PCS' : undefined;
    const hsn =
      body.hsn_sac !== undefined
        ? String(body.hsn_sac).trim().slice(0, 10) || null
        : undefined;
    const active = body.is_active !== undefined ? body.is_active === true : undefined;

    try {
      const item = await db.queryOne(
        `UPDATE expense_items SET
           name = COALESCE($3, name),
           item_type = COALESCE($4, item_type),
           unit = COALESCE($5, unit),
           hsn_sac = CASE WHEN $6::boolean THEN $7 ELSE hsn_sac END,
           tax_rate = COALESCE($8, tax_rate),
           is_active = COALESCE($9, is_active),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND business_id = $2
         RETURNING id, name, item_type, unit, hsn_sac, tax_rate::float AS tax_rate, is_active`,
        [params.id, session.businessId, name ?? null, itemType ?? null, unit ?? null, hsn !== undefined, hsn ?? null, taxRate ?? null, active ?? null]
      );
      return NextResponse.json({ item });
    } catch (error: any) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'An active expense item with this name already exists.', code: 'EXPENSE_ITEM_EXISTS' },
          { status: 409 }
        );
      }
      throw error;
    }
  } catch (error: any) {
    console.error('Error updating expense item:', error);
    return NextResponse.json({ error: 'Failed to update expense item', details: error.message }, { status: 500 });
  }
}
