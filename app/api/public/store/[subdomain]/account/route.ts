import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { orderTrackingUrl } from '@/lib/customer-surface/urls';

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

  const orders = await queryRows<Record<string, unknown> & { fulfilment_id: string | null; public_token: string | null }>(
    `SELECT so.id, so.order_number, so.status, so.payment_status, so.grand_total::text,
            so.delivery_mode, COALESCE(f.tracking_url, so.tracking_url) AS tracking_url,
            COALESCE(f.awb, so.awb) AS awb, so.created_at,
            f.id AS fulfilment_id, f.status AS delivery_status, f.partner_name, f.public_token,
            CASE WHEN f.status = 'ready_for_pickup' THEN f.pickup_code END AS pickup_code
     FROM store_orders so
     LEFT JOIN LATERAL (
       SELECT * FROM order_fulfilments x WHERE x.store_order_id = so.id ORDER BY x.seq LIMIT 1
     ) f ON TRUE
     WHERE so.business_id = $1 AND so.store_customer_id = $2
     ORDER BY so.created_at DESC
     LIMIT 50`,
    [store.business_id, session.customerId],
  );
  const fulfilmentIds = orders.map((o) => o.fulfilment_id).filter((id): id is string => Boolean(id));
  const events = fulfilmentIds.length
    ? await queryRows<{ fulfilment_id: string; status: string; note: string | null; created_at: string }>(
        `SELECT fulfilment_id, status, CASE WHEN status = 'delivery_failed' THEN note END AS note, created_at
           FROM order_fulfilment_events
          WHERE business_id = $1 AND fulfilment_id = ANY($2::uuid[])
          ORDER BY created_at, id`,
        [store.business_id, fulfilmentIds],
      )
    : [];

  return NextResponse.json({
    customer: {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      email: customer.email,
      last_address: addr?.address ?? lastOrd?.customer_address ?? null,
      last_pincode: addr?.pincode ?? lastOrd?.customer_pincode ?? null,
    },
    orders: orders.map(({ fulfilment_id, public_token, ...o }) => ({
      ...o,
      grand_total: parseFloat(o.grand_total as string) || 0,
      track_url: public_token ? orderTrackingUrl(public_token) : null,
      timeline: fulfilment_id
        ? events.filter((e) => e.fulfilment_id === fulfilment_id).map(({ fulfilment_id: _f, ...e }) => e)
        : [],
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
