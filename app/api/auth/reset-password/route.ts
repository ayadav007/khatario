import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { completeMerchantPasswordReset } from '@/lib/auth/merchant-password-reset';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (process.env.E2E_DISABLE_RATE_LIMIT !== 'true') {
    const rl = checkRateLimit(`merchant-reset:${ip}`, 12, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const result = await completeMerchantPasswordReset({
    phone: String(body.phone ?? ''),
    email: String(body.email ?? ''),
    whatsappCode: String(body.whatsappCode ?? body.whatsapp_code ?? ''),
    emailCode: String(body.emailCode ?? body.email_code ?? ''),
    newPassword: String(body.newPassword ?? body.new_password ?? ''),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Could not reset password' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
}
