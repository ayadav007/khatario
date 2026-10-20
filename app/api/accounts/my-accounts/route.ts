import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { loadMyAccounts, saveManualAccountIds } from '@/lib/accounting/my-accounts';
import { withPremiumSubscriptionApi } from '@/lib/security';

export const dynamic = 'force-dynamic';

export const GET = withPremiumSubscriptionApi({}, async (ctx) => {
  try {
    await authorize(ctx.userId, 'settings', 'read');
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const view = await loadMyAccounts(ctx.businessId);
  return NextResponse.json(view);
});

export const PUT = withPremiumSubscriptionApi({ parseJsonBody: true }, async (ctx) => {
  try {
    await authorize(ctx.userId, 'settings', 'update');
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const body = ctx.body as { account_ids?: unknown } | null;
  const accountIds = body?.account_ids;
  if (!Array.isArray(accountIds) || accountIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'account_ids must be a list of account ids' }, { status: 400 });
  }
  if (accountIds.length > 2000) {
    return NextResponse.json({ error: 'Too many accounts selected' }, { status: 400 });
  }

  try {
    const saved = await saveManualAccountIds(ctx.businessId, accountIds);
    return NextResponse.json({ manual_account_ids: saved });
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === 'ACCOUNT_NOT_FOUND') {
      return NextResponse.json({ error: error.message, code: 'ACCOUNT_NOT_FOUND' }, { status: 400 });
    }
    throw error;
  }
});
