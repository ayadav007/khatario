import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;

  const rows = await queryRows<Record<string, unknown>>(
    `SELECT id, code, discount_type, discount_value::text, min_order_amount::text,
            usage_cap, used_count, expires_at, is_active
     FROM store_coupons WHERE business_id = $1 ORDER BY created_at DESC`,
    [tenant.businessId],
  );
  return NextResponse.json({
    coupons: rows.map((r) => ({
      ...r,
      discount_value: parseFloat(r.discount_value as string) || 0,
      min_order_amount: parseFloat(r.min_order_amount as string) || 0,
    })),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const tenant = requireTenantBusinessId(request, body.business_id);
  if (!tenant.ok) return tenant.response;

  const code = String(body.code ?? '').trim().toUpperCase();
  if (code.length < 3) {
    return NextResponse.json({ error: 'Code must be at least 3 characters' }, { status: 400 });
  }

  const row = await queryOne(
    `INSERT INTO store_coupons
       (business_id, code, discount_type, discount_value, min_order_amount, usage_cap, expires_at, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (business_id, code) DO UPDATE SET
       discount_type = EXCLUDED.discount_type,
       discount_value = EXCLUDED.discount_value,
       min_order_amount = EXCLUDED.min_order_amount,
       usage_cap = EXCLUDED.usage_cap,
       expires_at = EXCLUDED.expires_at,
       is_active = EXCLUDED.is_active
     RETURNING id, code`,
    [
      tenant.businessId,
      code,
      body.discount_type === 'flat' ? 'flat' : 'percent',
      parseFloat(body.discount_value) || 0,
      parseFloat(body.min_order_amount) || 0,
      body.usage_cap != null ? Number(body.usage_cap) : null,
      body.expires_at || null,
      body.is_active !== false,
    ],
  );
  return NextResponse.json(row);
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await query(`DELETE FROM store_coupons WHERE id = $1 AND business_id = $2`, [
    id,
    tenant.businessId,
  ]);
  return NextResponse.json({ ok: true });
}
