import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  consumePlatformOtp,
  createVerifiedOtpResponse,
  issuePlatformOtp,
  nationalPhone10,
  type PlatformOtpPurpose,
} from '@/lib/platform-public-otp';

export const dynamic = 'force-dynamic';

const PURPOSES = new Set<PlatformOtpPurpose>(['signup', 'demo_booking']);

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const body = await request.json().catch(() => ({}));
  const action = body.action === 'verify' ? 'verify' : 'request';
  const purpose = body.purpose as PlatformOtpPurpose;
  if (!PURPOSES.has(purpose)) {
    return NextResponse.json({ error: 'Invalid purpose' }, { status: 400 });
  }
  const phone = nationalPhone10(String(body.phone ?? ''));
  if (!phone) {
    return NextResponse.json({ error: 'Enter a 10-digit mobile number' }, { status: 400 });
  }

  if (action === 'request') {
    const rl = checkRateLimit(`platform-otp-req:${purpose}:${ip}:${phone}`, 8, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many codes. Try again in a few minutes.' }, { status: 429 });
    }
    try {
      const extra = await issuePlatformOtp(purpose, phone);
      return NextResponse.json({ ok: true, ...extra });
    } catch (err) {
      console.error('[platform-otp] request', err);
      return NextResponse.json({ error: 'Could not send code' }, { status: 500 });
    }
  }

  const rl = checkRateLimit(`platform-otp-verify:${purpose}:${ip}:${phone}`, 20, 15 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  }
  const code = String(body.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 });
  }
  const ok = await consumePlatformOtp(purpose, phone, code);
  if (!ok) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });
  }
  return createVerifiedOtpResponse(purpose, phone);
}
