import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';

export const dynamic = 'force-dynamic';

function cookieClear() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  };
}

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

  const customer = await queryOne<{
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
  }>(
    `SELECT id, phone, name, email FROM store_customers WHERE id = $1 AND business_id = $2`,
    [session.customerId, store.business_id],
  );

  if (!customer) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const addr = await queryOne<{ address: string; pincode: string | null }>(
    `SELECT address, pincode FROM store_customer_addresses
     WHERE customer_id = $1
     ORDER BY is_default DESC, created_at DESC
     LIMIT 1`,
    [customer.id],
  );
  const lastOrd = addr
    ? null
    : await queryOne<{ customer_address: string | null; customer_pincode: string | null }>(
        `SELECT customer_address, customer_pincode FROM store_orders
         WHERE store_customer_id = $1 AND business_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [customer.id, store.business_id],
      );

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
    customer: {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      email: customer.email,
      last_address: addr?.address ?? lastOrd?.customer_address ?? null,
      last_pincode: addr?.pincode ?? lastOrd?.customer_pincode ?? null,
    },
    orders: orders.map((o) => ({
      ...o,
      grand_total: parseFloat(o.grand_total as string) || 0,
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const store = await resolveStoreBySubdomain(params.subdomain);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (body.action !== 'logout') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STORE_CUSTOMER_COOKIE, '', cookieClear());
  return res;
}
