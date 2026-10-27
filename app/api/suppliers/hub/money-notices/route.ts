import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { listMoneyNotices, pendingNotice, resolveNotice } from '@/lib/supplier-hub-money';

export const dynamic = 'force-dynamic';

/** GET /api/suppliers/hub/money-notices — payments and debit notes from connected buyers to act on. */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'invoices', 'read', { businessId: auth.businessId });
    return NextResponse.json({ notices: await listMoneyNotices(auth.businessId) });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('money notices GET', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

/**
 * POST /api/suppliers/hub/money-notices — { notice_id, action: 'record' | 'dismiss' }
 * record (payments only): saves the receipt against the bill through the normal payments API,
 * as the signed-in user, with the buyer's amount, date and mode. A retry cannot record twice.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json().catch(() => ({}));
    const notice = await pendingNotice(String(body.notice_id || ''), auth.businessId);
    if (!notice) return NextResponse.json({ error: 'This notice is already done' }, { status: 404 });

    if (body.action === 'dismiss') {
      await authorize(auth.userId, 'invoices', 'read', { businessId: auth.businessId });
      await resolveNotice(notice.id, auth.businessId, 'dismissed');
      return NextResponse.json({ ok: true });
    }
    if (body.action !== 'record' || notice.kind !== 'payment') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    headers.set('x-idempotency-key', `hub-money-notice-${notice.id}`);
    const { POST: createPayment } = await import('@/app/api/payments/route');
    const res = await createPayment(
      new NextRequest(new URL('/api/payments', request.url), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'receivable',
          reference_type: 'invoice',
          reference_id: notice.invoice_id,
          customer_id: notice.customer_id,
          amount: Number(notice.amount),
          payment_date: notice.happened_on,
          payment_mode: notice.payment_mode || 'bank_transfer',
          notes: `Paid by ${notice.buyer_name}, recorded from Supplier Hub${notice.note ? `: ${notice.note}` : ''}`,
        }),
      })
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.error || 'Could not record the receipt' }, { status: res.status });
    }
    await resolveNotice(notice.id, auth.businessId, 'recorded', data.payment?.id ?? null);
    return NextResponse.json({ ok: true, payment_id: data.payment?.id ?? null });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('money notices POST', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
