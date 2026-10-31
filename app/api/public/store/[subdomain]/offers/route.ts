import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { resolveStoreWithDraft } from '@/lib/store/preview-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/store/{subdomain}/offers
 * Coupons the merchant marked "Show in store" that can still be used. Private codes never appear.
 */
export async function GET(request: NextRequest, { params }: { params: { subdomain: string } }) {
  try {
    const td = request.nextUrl.searchParams.get('td');
    const store = await resolveStoreWithDraft(params.subdomain, td);
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    if (store.is_demo) {
      return NextResponse.json({
        coupons: [
          { code: 'FRESH50', discount_type: 'flat', discount_value: 50, min_order_amount: 499 },
          { code: 'SAVE10', discount_type: 'percent', discount_value: 10, min_order_amount: 299 },
        ],
      });
    }
    const rows = await queryRows<{ code: string; discount_type: 'percent' | 'flat'; discount_value: string; min_order_amount: string }>(
      `SELECT code, discount_type, discount_value::text, min_order_amount::text
       FROM store_coupons
       WHERE business_id = $1
         AND is_active = true
         AND show_in_store = true
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (usage_cap IS NULL OR used_count < usage_cap)
       ORDER BY min_order_amount ASC, code ASC
       LIMIT 10`,
      [store.business_id],
    );
    return NextResponse.json({
      coupons: rows.map((r) => ({
        code: r.code,
        discount_type: r.discount_type,
        discount_value: parseFloat(r.discount_value) || 0,
        min_order_amount: parseFloat(r.min_order_amount) || 0,
      })),
    });
  } catch (error) {
    console.error('[store offers]', error);
    return NextResponse.json({ error: 'Failed to load offers' }, { status: 500 });
  }
}
