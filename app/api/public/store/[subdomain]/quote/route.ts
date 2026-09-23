import { NextRequest, NextResponse } from 'next/server';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { buildStoreQuote } from '@/lib/store/quote';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  try {
    const store = await resolveStoreBySubdomain(params.subdomain);
    if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

    const body = await request.json();
    const quote = await buildStoreQuote({
      businessId: store.business_id,
      minOrderAmount: store.store_min_order_amount,
      branchId: body.branch_id,
      items: body.items ?? [],
      deliveryMode: body.delivery_mode === 'pickup' ? 'pickup' : 'delivery',
      pincode: body.customer_pincode,
      customerLat: body.customer_lat != null ? Number(body.customer_lat) : null,
      customerLng: body.customer_lng != null ? Number(body.customer_lng) : null,
      couponCode: body.coupon_code,
    });

    const status = quote.serviceable ? 200 : 400;
    return NextResponse.json(quote, { status });
  } catch (error) {
    console.error('[store quote]', error);
    return NextResponse.json({ error: 'Failed to quote' }, { status: 500 });
  }
}
