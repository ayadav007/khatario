import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { requestMerchantPasswordReset } from '@/lib/auth/merchant-password-reset';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (process.env.E2E_DISABLE_RATE_LIMIT !== 'true') {
    const rl = checkRateLimit(`merchant-forgot:${ip}`, 6, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const result = await requestMerchantPasswordReset({
    phone: String(body.phone ?? ''),
    email: String(body.email ?? ''),
  });
  return NextResponse.json(result);
}
