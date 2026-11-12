import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { InvoicePayError, startInvoiceOnlinePayment } from '@/lib/invoices/online-pay';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * POST /api/public/i/[token]/pay
 * Starts a gateway payment for the full balance of this public bill and returns the hosted
 * payment page. No staff session: the token is the bill's public link. The amount and business
 * come from the invoice, never from the request.
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public-invoice-pay:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests', retryAfterMs: rl.retryAfterMs }, { status: 429 });
  }
  try {
    const { paymentUrl, amount } = await startInvoiceOnlinePayment(params.token);
    return NextResponse.json({ payment_url: paymentUrl, amount });
  } catch (err) {
    if (err instanceof InvoicePayError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[public/i/pay] POST error:', err);
    return NextResponse.json({ error: 'Could not start the online payment' }, { status: 500 });
  }
}
