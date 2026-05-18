import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * GET /api/settings/item-sales-stock?business_id=
 * Default policy: allow invoicing goods when stock is insufficient (backorders).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const row = await queryOne<{ default_allow_sale_when_out_of_stock: boolean }>(
      `SELECT COALESCE(default_allow_sale_when_out_of_stock, false) AS default_allow_sale_when_out_of_stock
       FROM business_settings WHERE business_id = $1`,
      [businessId]
    );

    return NextResponse.json({
      default_allow_sale_when_out_of_stock: !!row?.default_allow_sale_when_out_of_stock,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[item-sales-stock GET]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/settings/item-sales-stock
 * Body: { business_id, default_allow_sale_when_out_of_stock: boolean }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = body.business_id as string | undefined;
    const default_allow_sale_when_out_of_stock = body.default_allow_sale_when_out_of_stock as boolean | undefined;

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (typeof default_allow_sale_when_out_of_stock !== 'boolean') {
      return NextResponse.json(
        { error: 'default_allow_sale_when_out_of_stock (boolean) is required' },
        { status: 400 }
      );
    }

    const existing = await queryOne(`SELECT business_id FROM business_settings WHERE business_id = $1`, [
      business_id,
    ]);

    let updated;
    if (existing) {
      updated = await queryOne<{ default_allow_sale_when_out_of_stock: boolean }>(
        `UPDATE business_settings
         SET default_allow_sale_when_out_of_stock = $1, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $2
         RETURNING default_allow_sale_when_out_of_stock`,
        [default_allow_sale_when_out_of_stock, business_id]
      );
    } else {
      updated = await queryOne<{ default_allow_sale_when_out_of_stock: boolean }>(
        `INSERT INTO business_settings (business_id, default_allow_sale_when_out_of_stock)
         VALUES ($1, $2)
         RETURNING default_allow_sale_when_out_of_stock`,
        [business_id, default_allow_sale_when_out_of_stock]
      );
    }

    return NextResponse.json({
      default_allow_sale_when_out_of_stock: !!updated?.default_allow_sale_when_out_of_stock,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[item-sales-stock PATCH]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
