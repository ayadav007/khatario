import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import {
  accountsForMode,
  classifyPaymentMode,
  resolveSettlementAccount,
} from '@/lib/accounting/settlement-accounts';
import { listSettlementAccounts } from '@/lib/accounting/settlement-accounts-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/accounting/settlement-accounts?payment_mode=upi
 * Cash, bank and clearing ledgers that a payment of this mode may post to.
 */
export async function GET(request: NextRequest) {
  try {
    const tenant = requireTenantBusinessId(request, new URL(request.url).searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    let allowed = false;
    let denied: AuthorizationError | null = null;
    for (const moduleName of ['payments', 'expenses', 'invoices', 'purchases'] as const) {
      try {
        await authorize(userId, moduleName, 'read', { businessId: tenant.businessId });
        allowed = true;
        break;
      } catch (error) {
        if (error instanceof AuthorizationError) {
          denied = error;
          continue;
        }
        throw error;
      }
    }
    if (!allowed && denied) return denied.toNextResponse();

    const mode = new URL(request.url).searchParams.get('payment_mode') || 'cash';
    const accounts = await listSettlementAccounts(tenant.businessId);
    const modeClass = classifyPaymentMode(mode);
    const eligible = accountsForMode(accounts, modeClass);
    const resolved = resolveSettlementAccount({ accounts, mode });
    return NextResponse.json({
      mode_class: modeClass,
      accounts: eligible.map((a) => ({
        id: a.id,
        account_code: a.code,
        account_name: a.name,
        kind: a.kind,
      })),
      default_account_id: resolved.ok ? resolved.accountId : null,
      selection_required: !resolved.ok && resolved.code === 'SETTLEMENT_ACCOUNT_REQUIRED',
      error: resolved.ok ? null : resolved.error,
      code: resolved.ok ? null : resolved.code,
    });
  } catch (error: any) {
    console.error('Error listing settlement accounts:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
