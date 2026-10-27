import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { InviteOrderError, loadInviteForSupplier, respondToInvite } from '@/lib/supplier-invites';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function limited(request: NextRequest) {
  const rl = checkRateLimit(`public-supplier-order:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
  return rl.allowed ? null : NextResponse.json({ error: 'Too many requests' }, { status: 429 });
}

/**
 * GET /api/public/supplier-order/[token]
 * An order a Khatario business sent to a supplier who is not on Khatario (no login; the token
 * is the only key). Opening it marks it seen for the buyer.
 */
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const denied = limited(request);
  if (denied) return denied;
  const view = await loadInviteForSupplier(params.token, { markViewed: true });
  if (!view) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const { _internal, ...order } = view;
  return NextResponse.json({ order });
}

/** POST — { decline?: true, lines?: [{ id, confirmed_qty }], note? }; answered once. */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const denied = limited(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const status = await respondToInvite(params.token, {
      decline: body.decline === true,
      lines: Array.isArray(body.lines) ? body.lines : [],
      note: typeof body.note === 'string' ? body.note : null,
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    if (error instanceof InviteOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('public supplier order respond', error);
    return NextResponse.json({ error: 'Failed to send your answer' }, { status: 500 });
  }
}
