import { NextResponse } from 'next/server';
import * as db from '@/lib/db';

/** Validates that `accountId` is an active expense ledger head for the business. */
export async function assertExpenseAccountForBusiness(
  businessId: string,
  accountId: string | null | undefined
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (accountId == null || accountId === '') {
    return { ok: true };
  }
  const row = await db.queryOne<{ id: string }>(
    `SELECT id FROM accounts
     WHERE id = $1 AND business_id = $2 AND account_type = 'expense' AND is_active = true`,
    [accountId, businessId]
  );
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid ledger account: must be an active expense account for this business.' },
        { status: 400 }
      ),
    };
  }
  return { ok: true };
}
