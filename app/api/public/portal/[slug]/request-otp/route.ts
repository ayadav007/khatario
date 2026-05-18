import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { query, queryRows } from '@/lib/db';
import { resolveBusinessByPortalSlug } from '@/lib/customer-surface';
import { sendBusinessEmail } from '@/lib/business-email';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const OTP_LIMIT = 8;
const OTP_WINDOW_MS = 15 * 60 * 1000;

function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`portal-otp-req:${ip}`, OTP_LIMIT, OTP_WINDOW_MS);
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
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const customers = await queryRows<{ id: string; name: string }>(
      `SELECT id, name
       FROM customers
       WHERE business_id = $1
         AND deleted_at IS NULL
         AND is_active = true
         AND portal_enabled = true
         AND lower(trim(email)) = $2
       LIMIT 1`,
      [business.id, email]
    );

    if (customers.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'If this email has portal access, you will receive a sign-in code shortly.',
      });
    }

    const customer = customers[0];
    const otp = generateOtp();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    await query(
      `INSERT INTO customer_portal_otps (business_id, customer_id, email, otp_code, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [business.id, customer.id, email, otp, expiresAt.toISOString()]
    );

    const html = [
      '<div style="font-family: Arial, sans-serif; font-size: 16px; color: #222;">',
      `<p>Hello ${escapeHtml(customer.name)},</p>`,
      `<p>Your sign-in code for <strong>${escapeHtml(business.name)}</strong> is:</p>`,
      `<p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">${otp}</p>`,
      '<p style="color: #555;">This code expires in 15 minutes. If you did not request it, ignore this email.</p>',
      '</div>',
    ].join('');

    const text = `Your sign-in code for ${business.name} is ${otp}. It expires in 15 minutes.`;

    await sendBusinessEmail(business.id, {
      to: email,
      subject: `Sign in to ${business.name}`,
      html,
      text,
    });

    return NextResponse.json({
      ok: true,
      message: 'If this email has portal access, you will receive a sign-in code shortly.',
    });
  } catch (error: unknown) {
    console.error('[portal/request-otp]', error);
    return NextResponse.json({ error: 'Failed to send sign-in code' }, { status: 500 });
  }
}
