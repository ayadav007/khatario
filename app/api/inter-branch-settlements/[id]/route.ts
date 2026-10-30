import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { InterBranchSettlementError, reverseInterBranchSettlement } from '@/lib/accounting/inter-branch-settlement';

export const dynamic = 'force-dynamic';

/** DELETE /api/inter-branch-settlements/:id — reverse a settlement (its postings are reversed, not deleted). */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const tenant = requireTenantBusinessId(request, null);
  if (!tenant.ok) return tenant.response;
  const s = await queryOne<{ payer_branch_id: string; payee_branch_id: string }>(
    `SELECT payer_branch_id, payee_branch_id FROM inter_branch_settlements WHERE id = $1 AND business_id = $2`,
    [params.id, tenant.businessId]
  );
  if (!s) return NextResponse.json({ error: 'Settlement not found' }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  const guards = [];
  for (const branchId of [s.payer_branch_id, s.payee_branch_id]) {
    const g = await guardLedgerRoute(request, {
      branchId,
      action: 'delete',
      dates: [today],
      actionLabel: 'reverse an inter-branch settlement',
    });
    if (!g.ok) return g.response;
    guards.push(g);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await reverseInterBranchSettlement(client, {
      businessId: tenant.businessId,
      settlementId: params.id,
      userId: guards[0].userId,
      date: today,
    });
    await client.query('COMMIT');
    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof InterBranchSettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Error reversing inter-branch settlement:', error);
    return NextResponse.json({ error: 'Failed to reverse the settlement' }, { status: 500 });
  } finally {
    client.release();
  }
}
