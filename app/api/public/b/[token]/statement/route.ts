import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { loadCustomerByBillsToken } from '@/lib/invoices/online-pay';
import {
  customerBillsUrl,
  customerDues,
  generateCustomerStatementPdf,
} from '@/lib/payment-reminders/statement';

export const dynamic = 'force-dynamic';

/** GET /api/public/b/[token]/statement — the customer's statement PDF (unpaid bills, then ledger). */
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`public-bills-pdf:${ip}`, 10, 60_000);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  try {
    const customer = await loadCustomerByBillsToken(params.token);
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const dues = await customerDues(customer.business_id, customer.id);
    if (dues.bills.length === 0) return NextResponse.json({ error: 'Nothing is due' }, { status: 404 });
    const pdf = await generateCustomerStatementPdf({
      businessId: customer.business_id,
      customerId: customer.id,
      dues,
      link: customerBillsUrl(params.token),
    });
    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="statement.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[public/b/statement] GET error:', err);
    return NextResponse.json({ error: 'Could not make the statement' }, { status: 500 });
  }
}
