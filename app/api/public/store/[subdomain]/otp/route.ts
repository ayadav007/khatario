import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { signStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const OTP_LIMIT = 8;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_LIMIT = 20;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  };
}

const DEV_BYPASS_OTP = '123456';

export async function POST(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const store = await resolveStoreBySubdomain(params.subdomain);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

  const body = await request.json();
  const action = body.action === 'verify' ? 'verify' : 'request';
  const phone = String(body.phone ?? '').replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) {
    return NextResponse.json({ error: 'Enter a 10-digit mobile number' }, { status: 400 });
  }

  if (action === 'request') {
    const rl = checkRateLimit(`store-otp-req:${store.business_id}:${getClientIp(request)}:${phone}`, OTP_LIMIT, OTP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many codes. Try again in a few minutes.' },
        { status: 429 },
      );
    }
    const code = DEV_BYPASS_OTP;
    await query(
      `INSERT INTO store_customer_otp (business_id, phone, code, expires_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
      [store.business_id, phone, code],
    );
    const { notifyStoreCustomerWhatsApp } = await import('@/lib/store/notify-whatsapp');
    void notifyStoreCustomerWhatsApp({
      businessId: store.business_id,
      phone,
      text: `Your ${store.name} verification code is ${code}. It expires in 10 minutes.`,
    });
    return NextResponse.json({
      ok: true,
      debug_otp: code,
    });
  }

  const verifyRl = checkRateLimit(
    `store-otp-verify:${store.business_id}:${getClientIp(request)}:${phone}`,
    VERIFY_LIMIT,
    VERIFY_WINDOW_MS,
  );
  if (!verifyRl.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in a few minutes.' },
      { status: 429 },
    );
  }

  const code = String(body.code ?? '').trim();
  const bypass = code === DEV_BYPASS_OTP;
  const row = bypass
    ? { id: 'bypass' }
    : await queryOne<{ id: string }>(
        `SELECT id FROM store_customer_otp
     WHERE business_id = $1 AND phone = $2 AND code = $3
       AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at DESC LIMIT 1`,
        [store.business_id, phone, code],
      );
  if (!row) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
  }

  if (!bypass) {
    await query(`DELETE FROM store_customer_otp WHERE id = $1`, [row.id]);
  }

  const existing = await queryOne<{ id: string; name: string | null; email: string | null }>(
    `SELECT id, name, email FROM store_customers WHERE business_id = $1 AND phone = $2`,
    [store.business_id, phone],
  );
  let customer = existing;
  if (!customer) {
    customer = await queryOne(
      `INSERT INTO store_customers (business_id, phone, name)
       VALUES ($1, $2, $3) RETURNING id, name, email`,
      [store.business_id, phone, body.name ?? null],
    );
  } else if (!customer.name && body.name) {
    await query(
      `UPDATE store_customers SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [String(body.name).trim(), customer.id],
    );
    customer = { ...customer, name: String(body.name).trim() };
  }

  const token = signStoreCustomer(store.business_id, customer!.id);
  const res = NextResponse.json({
    ok: true,
    customer: { id: customer!.id, phone, name: customer!.name, email: customer!.email },
  });
  res.cookies.set(STORE_CUSTOMER_COOKIE, token, cookieOptions());
  return res;
}
