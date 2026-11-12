import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { invoiceGateway, loadCustomerByBillsToken } from '@/lib/invoices/online-pay';
import { customerDues } from '@/lib/payment-reminders/statement';
import { businessSurfaceById } from '@/lib/customer-surface/business-surface';
import { ensureInvoicePublicToken } from '@/lib/customer-surface/public-token';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/b/[token]
 * A customer's unpaid bills with one shop (the page combined payment reminders link to).
 * No staff session: the token is the customer's unguessable bills link.
 */
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public-bills:${ip}`, 120, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  try {
    const customer = await loadCustomerByBillsToken(params.token);
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const [business, dues, gateway] = await Promise.all([
      businessSurfaceById(customer.business_id),
      customerDues(customer.business_id, customer.id),
      invoiceGateway(customer.business_id).catch(() => null),
    ]);
    if (!business) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const bills = await Promise.all(
      dues.bills.map(async (b) => {
        let link: string | null = null;
        try {
          link = `/i/${encodeURIComponent(await ensureInvoicePublicToken(b.id))}`;
        } catch {
          link = null;
        }
        return { ...b, link };
      }),
    );
    return NextResponse.json({
      business,
      customer_name: customer.name || 'Customer',
      bills,
      bills_due: dues.billsDue,
      advance: dues.advance,
      to_pay: dues.toPay,
      overdue: dues.overdue,
      pay: { online: gateway !== null },
    });
  } catch (err) {
    console.error('[public/b] GET error:', err);
    return NextResponse.json({ error: 'Could not load your bills' }, { status: 500 });
  }
}
