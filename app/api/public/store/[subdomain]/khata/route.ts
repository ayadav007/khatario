import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { KhataError, khataCustomerForShopper, requestKhataFromStore } from '@/lib/khata/service';
import { storeKhataDetail, storeKhataStatementView, storeKhataStatus } from '@/lib/khata/store-view';
import { findKhataStatementByToken } from '@/lib/khata/statements';
import { startKhataOnlinePayment } from '@/lib/khata/online-pay';

export const dynamic = 'force-dynamic';

async function signedIn(request: NextRequest, businessId: string): Promise<string | null> {
  const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
  if (!session || session.businessId !== businessId) return null;
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM store_customers WHERE id = $1 AND business_id = $2`,
    [session.customerId, businessId],
  );
  return row?.id ?? null;
}

/**
 * GET /api/public/store/[subdomain]/khata
 * ?s=<statement token>: that statement, no sign-in (the link was sent to the customer's WhatsApp).
 * Otherwise the signed-in shopper's khata: status, open bills, payments, statements, how to pay.
 */
export async function GET(request: NextRequest, { params }: { params: { subdomain: string } }) {
  const store = await resolveStoreBySubdomain(params.subdomain);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  const token = request.nextUrl.searchParams.get('s');
  if (token) {
    const statement = await findKhataStatementByToken(token);
    if (!statement || statement.business_id !== store.business_id) {
      return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
    }
    return NextResponse.json({ kind: 'statement', ...(await storeKhataStatementView(store.business_id, store.name, statement)) });
  }

  const shopperId = await signedIn(request, store.business_id);
  if (!shopperId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const detail = await storeKhataDetail(store.business_id, store.name, shopperId);
  if (detail) return NextResponse.json({ kind: 'khata', ...detail });
  return NextResponse.json({ kind: 'status', khata: await storeKhataStatus(store.business_id, shopperId) });
}

/**
 * POST /api/public/store/[subdomain]/khata
 * { action: 'request' }: signed-in shopper asks the shop for a khata.
 * { action: 'pay', amount?, s? }: start an online payment for the khata (signed in, or with a
 * statement token from the WhatsApp link). Only when the shop has an online gateway.
 */
export async function POST(request: NextRequest, { params }: { params: { subdomain: string } }) {
  const store = await resolveStoreBySubdomain(params.subdomain);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  if (store.is_demo) return NextResponse.json({ error: 'This is a theme preview.' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    if (body.action === 'request') {
      const shopperId = await signedIn(request, store.business_id);
      if (!shopperId) return NextResponse.json({ error: 'Verify your number first' }, { status: 401 });
      const result = await requestKhataFromStore({ businessId: store.business_id, storeCustomerId: shopperId });
      return NextResponse.json({ ok: true, status: result.status });
    }

    if (body.action === 'pay') {
      const amount = body.amount == null || body.amount === '' ? null : Number(body.amount);
      let customerId: string | null = null;
      let shopperId: string | null = null;
      if (typeof body.s === 'string' && body.s) {
        const statement = await findKhataStatementByToken(body.s);
        if (!statement || statement.business_id !== store.business_id) {
          return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
        }
        customerId = statement.customer_id;
      } else {
        shopperId = await signedIn(request, store.business_id);
        if (!shopperId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
        const c = await khataCustomerForShopper(store.business_id, shopperId);
        if (!c || !c.khata_enabled) {
          return NextResponse.json({ error: 'Khata is not open for this number' }, { status: 400 });
        }
        customerId = c.id;
      }
      const started = await startKhataOnlinePayment({
        businessId: store.business_id,
        customerId,
        storeCustomerId: shopperId,
        amount,
        storeSubdomain: store.store_subdomain,
      });
      return NextResponse.json({ ok: true, payment_url: started.paymentUrl, amount: started.amount });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof KhataError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[store khata]', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
