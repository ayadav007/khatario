import { NextRequest, NextResponse } from 'next/server';
import { handleEasebuzzCallback } from '@/lib/payments/easebuzz-callback';
import { resolvePublicRequestOrigin } from '@/lib/http/public-request-origin';

export const dynamic = 'force-dynamic';

function redirectTo(request: NextRequest, path: string): NextResponse {
  const origin = resolvePublicRequestOrigin(request).replace(/\/$/, '');
  return NextResponse.redirect(new URL(path, `${origin}/`), 303);
}

/**
 * POST /api/payments/return/easebuzz — Easebuzz `surl` / `furl`.
 *
 * The customer's browser posts the signed result here. It is verified and applied exactly like
 * the webhook (idempotent), then the browser is sent to a fixed, same-origin page.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await request.text();
    const result = await handleEasebuzzCallback(rawBody);
    if (result.httpStatus >= 400) {
      console.warn('[payments/return/easebuzz]', result.httpStatus, result.body.error ?? '');
    }
    return redirectTo(request, result.redirectPath);
  } catch (error) {
    console.error('[payments/return/easebuzz] Unexpected error', error);
    return redirectTo(request, '/pay/complete?status=pending&provider=easebuzz');
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return redirectTo(request, '/pay/complete?status=pending&provider=easebuzz');
}
