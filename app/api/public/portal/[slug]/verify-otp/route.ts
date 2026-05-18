import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import {
  createCustomerPortalSession,
  customerPortalCookieOptions,
  CUSTOMER_PORTAL_COOKIE,
  resolveBusinessByPortalSlug,
} from '@/lib/customer-surface';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const VERIFY_LIMIT = 20;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`portal-otp-verify:${ip}`, VERIFY_LIMIT, VERIFY_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.', retryAfterMs: rl.retryAfterMs },
      { status: 429 }
    );
  }

  try {
    const business = await resolveBusinessByPortalSlug(params.slug);
    if (!business) {
      return NextResponse.json({ error: 'Portal not found' }, { status: 404 });
    }

    const body = await request.json();
    const email = String(body?.email ?? '')
      .trim()
      .toLowerCase();
    const otpCode = String(body?.otp ?? body?.otp_code ?? '').trim();

    if (!email || !otpCode) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 });
    }

    const otp = await queryOne<{ id: string; customer_id: string }>(
      `SELECT id, customer_id
       FROM customer_portal_otps
       WHERE business_id = $1
         AND lower(trim(email)) = $2
         AND otp_code = $3
         AND expires_at > CURRENT_TIMESTAMP
         AND is_used = false
       ORDER BY created_at DESC
       LIMIT 1`,
      [business.id, email, otpCode]
    );

    if (!otp) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
    }

    await query(`UPDATE customer_portal_otps SET is_used = true WHERE id = $1`, [otp.id]);

    const { token, expiresAt } = await createCustomerPortalSession(
      business.id,
      otp.customer_id
    );

    const customer = await queryOne<{ name: string }>(
      `SELECT name FROM customers WHERE id = $1`,
      [otp.customer_id]
    );

    const res = NextResponse.json({
      ok: true,
      customer: {
        id: otp.customer_id,
        name: customer?.name ?? 'Customer',
      },
    });

    res.cookies.set(CUSTOMER_PORTAL_COOKIE, token, customerPortalCookieOptions(expiresAt));
    return res;
  } catch (error: unknown) {
    console.error('[portal/verify-otp]', error);
    return NextResponse.json({ error: 'Sign-in failed' }, { status: 500 });
  }
}
