import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryRows } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import { listCashBankAccounts } from '@/lib/accounting/contra';
import {
  InterBranchSettlementError,
  interBranchBalances,
  settleInterBranchBalance,
} from '@/lib/accounting/inter-branch-settlement';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inter-branch-settlements — open balances between branches, past settlements, and the
 * cash/bank accounts a settlement can use.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await guardLedgerRoute(request, {
      claimedBusinessId: new URL(request.url).searchParams.get('business_id'),
      action: 'read',
    });
    if (!guard.ok) return guard.response;
    const { businessId } = guard;

    const client = await getPool().connect();
    try {
      const [balances, accounts] = await Promise.all([
        interBranchBalances(client, businessId),
        listCashBankAccounts(client, businessId),
      ]);
      const settlements = await queryRows(
        `SELECT s.id, s.mode, s.amount, to_char(s.settlement_date, 'YYYY-MM-DD') AS settlement_date, s.reference, s.notes,
                s.reversed_at, s.payer_branch_id, pb.name AS payer_branch_name, s.payee_branch_id, qb.name AS payee_branch_name
           FROM inter_branch_settlements s
           JOIN branches pb ON pb.id = s.payer_branch_id
           JOIN branches qb ON qb.id = s.payee_branch_id
          WHERE s.business_id = $1
          ORDER BY s.settlement_date DESC, s.created_at DESC
          LIMIT 200`,
        [businessId]
      );
      return NextResponse.json({ balances, settlements, accounts });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error loading inter-branch balances:', error);
    return NextResponse.json({ error: 'Failed to load inter-branch balances' }, { status: 500 });
  }
}

/**
 * POST /api/inter-branch-settlements
 * Body: { payer_branch_id, payee_branch_id, mode: 'payment'|'netting', amount, settlement_date,
 *         payer_account_id?, payee_account_id?, reference?, notes? }
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const date = typeof body?.settlement_date === 'string' ? body.settlement_date.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'settlement_date (YYYY-MM-DD) is required' }, { status: 400 });
  }
  if (!body.payer_branch_id || !body.payee_branch_id) {
    return NextResponse.json({ error: 'payer_branch_id and payee_branch_id are required' }, { status: 400 });
  }

  // Both branches' books change, so the user needs ledger rights and an open period in each.
  const payer = await guardLedgerRoute(request, {
    claimedBusinessId: body.business_id,
    branchId: String(body.payer_branch_id),
    action: 'create',
    dates: [date],
    actionLabel: 'settle an inter-branch balance',
  });
  if (!payer.ok) return payer.response;
  const payee = await guardLedgerRoute(request, {
    claimedBusinessId: body.business_id,
    branchId: String(body.payee_branch_id),
    action: 'create',
    dates: [date],
    actionLabel: 'settle an inter-branch balance',
  });
  if (!payee.ok) return payee.response;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { id } = await settleInterBranchBalance(client, {
      businessId: payer.businessId,
      userId: payer.userId,
      payerBranchId: payer.branchId!,
      payeeBranchId: payee.branchId!,
      mode: body.mode === 'netting' ? 'netting' : 'payment',
      amount: Number(body.amount),
      date,
      payerAccountId: body.payer_account_id || null,
      payeeAccountId: body.payee_account_id || null,
      reference: typeof body.reference === 'string' ? body.reference.slice(0, 100) : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    });
    await client.query('COMMIT');
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof InterBranchSettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Error settling inter-branch balance:', error);
    return NextResponse.json({ error: 'Failed to settle the inter-branch balance' }, { status: 500 });
  } finally {
    client.release();
  }
}
