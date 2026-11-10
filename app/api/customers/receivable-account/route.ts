import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import { ReceivableAccountError, assertReceivableTarget } from '@/lib/accounting/receivable-accounts';
import { moveCustomerReceivableAccount } from '@/lib/accounting/receivable-account-move';
import {
  isUuid,
  parseReceivableAccountId,
  receivableAccountErrorResponse,
} from '@/lib/customers/receivable-account-request';

export const dynamic = 'force-dynamic';

const MAX_CUSTOMERS = 500;

type BulkResult = {
  customer_id: string;
  ok: boolean;
  transferred_amount?: number;
  error?: string;
  code?: string;
};

/**
 * POST /api/customers/receivable-account
 * Body: { customer_ids: string[], receivable_account_id: string | null }
 *
 * Sets the receivable account of up to 500 customers. Each customer is moved in its own
 * transaction, so one that cannot be moved does not stop the others; the response lists every
 * outcome. The business and the acting user come from the session.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const body = await request.json().catch(() => ({}));

    try {
      await authorize(session.userId, 'customers', 'update', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const rawIds: unknown[] = Array.isArray(body?.customer_ids) ? body.customer_ids : [];
    const customerIds = [...new Set(rawIds.filter((id): id is string => typeof id === 'string'))];
    if (customerIds.length === 0) {
      return NextResponse.json({ error: 'Choose at least one customer', code: 'NO_CUSTOMERS' }, { status: 400 });
    }
    if (customerIds.length > MAX_CUSTOMERS) {
      return NextResponse.json(
        { error: `Choose at most ${MAX_CUSTOMERS} customers at a time`, code: 'TOO_MANY_CUSTOMERS' },
        { status: 400 },
      );
    }

    let toAccountId: string | null;
    try {
      toAccountId = parseReceivableAccountId(body?.receivable_account_id);
      // Checked once up front, so a wrong account is one clear error and not one per customer.
      await assertReceivableTarget(session.businessId, toAccountId);
    } catch (error) {
      const refused = receivableAccountErrorResponse(error);
      if (refused) return refused;
      throw error;
    }

    const results: BulkResult[] = [];
    for (const customerId of customerIds) {
      if (!isUuid(customerId)) {
        results.push({ customer_id: customerId, ok: false, error: 'Customer not found', code: 'NOT_FOUND' });
        continue;
      }
      try {
        const moved = await moveCustomerReceivableAccount({
          businessId: session.businessId,
          customerId,
          toAccountId,
          actorId: session.userId,
        });
        results.push({ customer_id: customerId, ok: true, transferred_amount: moved.transferredAmount });
      } catch (error) {
        if (error instanceof ReceivableAccountError) {
          results.push({ customer_id: customerId, ok: false, error: error.message, code: error.code });
        } else {
          console.error('Bulk receivable account change failed for a customer:', error);
          results.push({ customer_id: customerId, ok: false, error: 'Could not change this customer', code: 'FAILED' });
        }
      }
    }

    return NextResponse.json({
      results,
      moved: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    });
  } catch (error: any) {
    console.error('Error changing receivable accounts:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
