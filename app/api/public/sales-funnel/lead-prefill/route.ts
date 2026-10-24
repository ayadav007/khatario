import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { signupPrefill } from '@/lib/sales-funnel/signup';

export const dynamic = 'force-dynamic';

/** GET /api/public/sales-funnel/lead-prefill?token= — signup form values for a WhatsApp signup link. */
export async function GET(request: NextRequest) {
  const rl = checkRateLimit(`lead-prefill:${getClientIp(request)}`, 30, 60_000);
  if (!rl.allowed) return NextResponse.json({ valid: false, reason: 'invalid' }, { status: 429 });
  const token = request.nextUrl.searchParams.get('token');
  try {
    return NextResponse.json(await signupPrefill(token));
  } catch (err) {
    console.error('[lead-prefill] failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ valid: false, reason: 'invalid' });
  }
}
