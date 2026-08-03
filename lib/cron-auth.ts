import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron routes require `Authorization: Bearer <CRON_SECRET>`.
 * Vercel Cron sends this header when CRON_SECRET is configured.
 * Fails closed when CRON_SECRET is missing so jobs cannot run unauthenticated.
 */
export function assertCronAuthorized(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: 'Cron authentication is not configured (CRON_SECRET missing)' },
      { status: 503 }
    );
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
