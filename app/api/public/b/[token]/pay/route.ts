import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { InvoicePayError, startCustomerBillsPayment } from '@/lib/invoices/online-pay';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/public/b/[token]/pay  { invoice_ids?: string[] }
 * Starts one gateway payment for all unpaid bills (less advance), or for the bills picked.
 * Amounts come from the database; the ids only say which of this customer's bills.
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public-bills-pay:${ip}`, 10, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  let ids: string[] | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as { invoice_ids?: unknown };
    if (Array.isArray(body.invoice_ids)) {
      ids = body.invoice_ids.filter((v): v is string => typeof v === 'string' && UUID.test(v)).slice(0, 200);
      if (ids.length !== body.invoice_ids.length) {
        return NextResponse.json({ error: 'Invalid bill list' }, { status: 400 });
      }
      if (ids.length === 0) ids = null;
    }
    const { paymentUrl, amount } = await startCustomerBillsPayment(params.token, ids);
    return NextResponse.json({ payment_url: paymentUrl, amount });
  } catch (err) {
    if (err instanceof InvoicePayError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[public/b/pay] POST error:', err);
    return NextResponse.json({ error: 'Could not start the online payment' }, { status: 500 });
  }
}
