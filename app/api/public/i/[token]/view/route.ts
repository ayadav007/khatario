import { NextRequest, NextResponse } from 'next/server';
import {
  recordInvoiceCustomerView,
  resolveInvoiceByPublicToken,
} from '@/lib/customer-surface';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

/**
 * POST /api/public/i/[token]/view
 * Record customer opened the public bill (first-view notification).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public-invoice-view:${ip}:${params.token}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
  }

  try {
    const resolved = await resolveInvoiceByPublicToken(params.token);
    if (!resolved) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    let source: 'public_link' | 'portal' = 'public_link';
    try {
      const body = await request.json();
      if (body?.source === 'portal') source = 'portal';
    } catch {
      // empty body is fine
    }

    const { firstView } = await recordInvoiceCustomerView({
      invoiceId: resolved.invoice_id,
      businessId: resolved.business_id,
      customerName: resolved.customer_name,
      invoiceNumber: resolved.summary.invoice_number,
      source,
      notifyOnFirstView: resolved.business.surface_settings.notify_on_first_view !== false,
    });

    return NextResponse.json({ ok: true, firstView });
  } catch (error: unknown) {
    console.error('[public/i/view] error:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
