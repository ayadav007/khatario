import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { gstRateError } from '@/lib/gst/rates';

export const dynamic = 'force-dynamic';

const TYPES = new Set(['goods', 'service']);

function cleanItem(body: Record<string, unknown>, partial: boolean) {
  const name = body.name == null ? undefined : String(body.name).trim();
  if (!partial && !name) return { error: 'Item name is required.' };
  if (name !== undefined && !name) return { error: 'Item name is required.' };
  if (name && name.length > 255) return { error: 'Item name is too long.' };
  const itemType = body.item_type == null ? undefined : String(body.item_type);
  if (itemType !== undefined && !TYPES.has(itemType)) return { error: 'Item must be goods or a service.' };
  if (!partial && !itemType) return { error: 'Item must be goods or a service.' };
  const unit = body.unit == null || String(body.unit).trim() === '' ? 'PCS' : String(body.unit).trim().slice(0, 50);
  const hsn = body.hsn_sac == null || String(body.hsn_sac).trim() === '' ? null : String(body.hsn_sac).trim().slice(0, 10);
  let taxRate: number | undefined;
  if (body.tax_rate !== undefined && body.tax_rate !== null && body.tax_rate !== '') {
    const rateError = gstRateError(body.tax_rate);
    if (rateError) return { error: rateError };
    taxRate = Number(body.tax_rate);
  } else if (!partial) {
    taxRate = 0;
  }
  return { name, itemType, unit, hsn, taxRate };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    try {
      await authorize(session.userId, 'expenses', 'read', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
    const includeInactive = new URL(request.url).searchParams.get('include_inactive') === '1';
    const items = await db.queryRows(
      `SELECT id, name, item_type, unit, hsn_sac, tax_rate::float AS tax_rate, is_active
         FROM expense_items
        WHERE business_id = $1 AND ($2::boolean OR is_active = true)
        ORDER BY name`,
      [session.businessId, includeInactive]
    );
    return NextResponse.json({ items });
  } catch (error: any) {
    console.error('Error fetching expense items:', error);
    return NextResponse.json({ error: 'Failed to fetch expense items', details: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    try {
      await authorize(session.userId, 'expenses', 'create', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
    const body = await request.json();
    const cleaned = cleanItem(body, false);
    if ('error' in cleaned && cleaned.error) {
      return NextResponse.json({ error: cleaned.error, code: 'EXPENSE_ITEM_INVALID' }, { status: 400 });
    }
    try {
      const item = await db.queryOne(
        `INSERT INTO expense_items (business_id, name, item_type, unit, hsn_sac, tax_rate)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, item_type, unit, hsn_sac, tax_rate::float AS tax_rate, is_active`,
        [session.businessId, cleaned.name, cleaned.itemType, cleaned.unit, cleaned.hsn, cleaned.taxRate]
      );
      return NextResponse.json({ item }, { status: 201 });
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
    console.error('Error creating expense item:', error);
    return NextResponse.json({ error: 'Failed to create expense item', details: error.message }, { status: 500 });
  }
}
