import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const store = await resolveStoreBySubdomain(params.subdomain);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
  if (!session || session.businessId !== store.business_id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const orders = await queryRows<Record<string, unknown>>(
    `SELECT id, order_number, status, payment_status, grand_total::text,
            delivery_mode, tracking_url, awb, created_at
     FROM store_orders
     WHERE business_id = $1 AND store_customer_id = $2
     ORDER BY created_at DESC
     LIMIT 50`,
    [store.business_id, session.customerId],
  );

  return NextResponse.json({
    orders: orders.map((o) => ({
      ...o,
      grand_total: parseFloat(o.grand_total as string) || 0,
    })),
  });
}
