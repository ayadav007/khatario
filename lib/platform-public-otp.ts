import { randomInt } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { notifyStoreCustomerWhatsApp } from '@/lib/store/notify-whatsapp';
import { hashPlatformOtp as hashOtpCore, nationalPhone10, type PlatformOtpPurpose } from '@/lib/platform-public-otp-core';
import { sendPlatformEventWhatsApp } from '@/lib/platform-whatsapp-send';

export { nationalPhone10 };
export type { PlatformOtpPurpose };

export const PLATFORM_OTP_COOKIE = 'khatario_public_otp';
const OTP_MAX_AGE_SEC = 15 * 60;

function otpPepper(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function hashPlatformOtp(purpose: PlatformOtpPurpose, phone: string, code: string): string {
  return hashOtpCore(purpose, phone, code, otpPepper());
}

function allowOtpDebug(): boolean {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  return process.env.SIGNUP_DEBUG === 'true' || appUrl.includes('staging.');
}

export async function issuePlatformOtp(
  purpose: PlatformOtpPurpose,
  phone: string,
  opts?: { email?: string },
): Promise<{ debugOtp?: string }> {
  const code = String(randomInt(100000, 1000000));
  const codeHash = hashPlatformOtp(purpose, phone, code);
  await query(
    `DELETE FROM platform_public_otps
     WHERE purpose = $1 AND phone = $2 AND consumed_at IS NULL`,
    [purpose, phone],
  );
  await query(
    `INSERT INTO platform_public_otps (purpose, phone, code_hash, expires_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
    [purpose, phone, codeHash],
  );

  if (purpose === 'password_reset_email') {
    const to = opts?.email?.trim();
    if (to) {
      const { sendPlatformEmail, platformEmailLayout } = await import('@/lib/platform-email');
      await sendPlatformEmail({
        to,
        subject: 'Your Khatario password reset code',
        html: platformEmailLayout(
          'Password reset',
          `<p>Your email verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. You also need the WhatsApp code to reset your password.</p>`,
        ),
        text: `Your Khatario email verification code is ${code}. It expires in 10 minutes. You also need the WhatsApp code.`,
      });
    }
    if (allowOtpDebug()) console.log(`[platform-otp] ${purpose} ${phone}: ${code}`);
    return allowOtpDebug() ? { debugOtp: code } : {};
  }

  const eventKey = purpose === 'demo_booking' ? 'demo_booking_otp' : 'signup_otp';
  const graph = await sendPlatformEventWhatsApp({ eventKey, toPhone: phone, vars: [code] });
  if (!graph.sent) {
    const text = `Your Khatario verification code is ${code}. It expires in 10 minutes.`;
    const businessId = process.env.PLATFORM_WHATSAPP_BUSINESS_ID?.trim();
    if (businessId) {
      await notifyStoreCustomerWhatsApp({ businessId, phone, text });
    } else {
      console.warn('[platform-otp] No approved Cloud API template and PLATFORM_WHATSAPP_BUSINESS_ID is not set');
      if (allowOtpDebug()) console.log(`[platform-otp] ${purpose} ${phone}: ${code}`);
    }
  }

  return allowOtpDebug() ? { debugOtp: code } : {};
}

export async function consumePlatformOtpPair(
  phone: string,
  waCode: string,
  emailCode: string,
): Promise<boolean> {
  const waHash = hashPlatformOtp('password_reset_wa', phone, waCode.trim());
  const emHash = hashPlatformOtp('password_reset_email', phone, emailCode.trim());
  const wa = await queryOne<{ id: string }>(
    `SELECT id FROM platform_public_otps
     WHERE purpose = 'password_reset_wa' AND phone = $1 AND code_hash = $2
       AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at DESC LIMIT 1`,
    [phone, waHash],
  );
  const em = await queryOne<{ id: string }>(
    `SELECT id FROM platform_public_otps
     WHERE purpose = 'password_reset_email' AND phone = $1 AND code_hash = $2
       AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at DESC LIMIT 1`,
    [phone, emHash],
  );
  if (!wa || !em) return false;
  await query(`UPDATE platform_public_otps SET consumed_at = CURRENT_TIMESTAMP WHERE id = ANY($1::uuid[])`, [
    [wa.id, em.id],
  ]);
  return true;
}

export async function consumePlatformOtp(
  purpose: PlatformOtpPurpose,
  phone: string,
  code: string,
): Promise<boolean> {
  const codeHash = hashPlatformOtp(purpose, phone, code.trim());
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM platform_public_otps
     WHERE purpose = $1 AND phone = $2 AND code_hash = $3
       AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at DESC
     LIMIT 1`,
    [purpose, phone, codeHash],
  );
  if (!row) return false;
  await query(`UPDATE platform_public_otps SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.id]);
  return true;
}

async function signOtpProof(purpose: PlatformOtpPurpose, phone: string): Promise<string> {
  return new SignJWT({ typ: 'platform_otp', purpose, phone })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${OTP_MAX_AGE_SEC}s`)
    .sign(new TextEncoder().encode(otpPepper()));
}

export function setPlatformOtpCookie(response: NextResponse, token: string): void {
  response.cookies.set(PLATFORM_OTP_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OTP_MAX_AGE_SEC,
  });
}

export async function createVerifiedOtpResponse(purpose: PlatformOtpPurpose, phone: string) {
  const token = await signOtpProof(purpose, phone);
  const res = NextResponse.json({ ok: true });
  setPlatformOtpCookie(res, token);
  return res;
}

export async function requestHasVerifiedPlatformOtp(
  request: NextRequest,
  purpose: PlatformOtpPurpose,
  phone: string,
): Promise<boolean> {
  const token = request.cookies.get(PLATFORM_OTP_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(otpPepper()));
    return payload.typ === 'platform_otp' && payload.purpose === purpose && payload.phone === phone;
  } catch {
    return false;
  }
}
