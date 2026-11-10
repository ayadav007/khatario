import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import { moveCustomerReceivableAccount } from '@/lib/accounting/receivable-account-move';
import { parseReceivableAccountId, receivableAccountErrorResponse } from '@/lib/customers/receivable-account-request';

export const dynamic = 'force-dynamic';

/**
 * POST /api/customers/[id]/receivable-account
 * Body: { receivable_account_id: string | null, dry_run?: boolean }
 *
 * Changes the ledger account this customer's sales are recorded in (null = Accounts Receivable)
 * and transfers what the customer owes in any other receivable account, dated today.
 * `dry_run` returns the amount that would be transferred and changes nothing.
 * The business and the acting user come from the session.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const body = await request.json().catch(() => ({}));

    try {
      await authorize(session.userId, 'customers', 'update', {
        businessId: session.businessId,
        resourceId: params.id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    try {
      const result = await moveCustomerReceivableAccount({
        businessId: session.businessId,
        customerId: params.id,
        toAccountId: parseReceivableAccountId(body?.receivable_account_id),
        actorId: session.userId,
        dryRun: body?.dry_run === true,
      });
      return NextResponse.json({ result });
    } catch (error) {
      const refused = receivableAccountErrorResponse(error);
      if (refused) return refused;
      throw error;
    }
  } catch (error: any) {
    console.error('Error changing customer receivable account:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
