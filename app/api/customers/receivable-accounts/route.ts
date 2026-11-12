import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import { ReceivableAccountError, listReceivableAccounts } from '@/lib/accounting/receivable-accounts';
import * as schema from '@/lib/accounting/receivable-accounts-schema';

export const dynamic = 'force-dynamic';

/**
 * GET /api/customers/receivable-accounts
 * Accounts a customer can be assigned to: Accounts Receivable and every account under it.
 * `available` is false until migration 468 is applied, and the pickers then stay hidden.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    try {
      await authorize(session.userId, 'customers', 'read', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    if (!(await schema.hasCustomerReceivableAccounts())) {
      return NextResponse.json({ available: false, control_account_id: null, accounts: [] });
    }
    try {
      const { controlAccountId, accounts } = await listReceivableAccounts(session.businessId);
      return NextResponse.json({ available: true, control_account_id: controlAccountId, accounts });
    } catch (error) {
      // A business with no Accounts Receivable account has nothing to choose from.
      if (error instanceof ReceivableAccountError && error.code === 'RECEIVABLE_CONTROL_MISSING') {
        return NextResponse.json({ available: true, control_account_id: null, accounts: [] });
      }
      throw error;
    }
  } catch (error: any) {
    console.error('Error listing receivable accounts:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
