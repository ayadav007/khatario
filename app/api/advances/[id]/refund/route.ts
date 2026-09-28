import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import { AdvanceError, refundAdvance } from '@/lib/accounting/advance-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/advances/[id]/refund — Rule 51 refund voucher (customer advance returned) or a supplier
 * returning an advance we paid.
 * Body: { amount, refund_date, payment_account_id, notes? }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const date = typeof body?.refund_date === 'string' ? body.refund_date.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'refund_date (YYYY-MM-DD) is required' }, { status: 400 });
  }

  const sessionBiz = getSessionScopedBusinessId(request);
  const adv = sessionBiz
    ? await queryOne<{ type: string; supply_type: string; branch_id: string | null }>(
        `SELECT type, supply_type, branch_id FROM advance_payments WHERE id = $1 AND business_id = $2`,
        [id, sessionBiz]
      )
    : null;

  const guard = await guardLedgerRoute(request, {
    claimedBusinessId: body.business_id,
    branchId: body.branch_id || adv?.branch_id || null,
    action: 'create',
    dates: [date],
    actionLabel: 'refund an advance',
    checkGstFiled: adv?.type === 'received' && adv?.supply_type === 'services',
  });
  if (!guard.ok) return guard.response;
  if (!adv) return NextResponse.json({ error: 'Advance not found' }, { status: 404 });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await refundAdvance(client, {
      businessId: guard.businessId,
      branchId: guard.branchId,
      userId: guard.userId,
      advanceId: id,
      amount: Number(body.amount),
      date,
      paymentAccountId: String(body.payment_account_id || ''),
      notes: body.notes || null,
    });
    await client.query('COMMIT');
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof AdvanceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Error refunding advance:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
