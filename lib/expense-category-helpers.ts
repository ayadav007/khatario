import { NextResponse } from 'next/server';
import * as db from '@/lib/db';
import {
  EXPENSE_ACCOUNT_REJECTED,
  EXPENSE_ACCOUNT_REQUIRED,
  isOrdinaryOperatingExpenseAccount,
} from '@/lib/accounting/expense-account-policy';
import type { PlAccountLike } from '@/lib/accounting/pl-sections';

const ACCOUNT_SQL = `
  SELECT a.id, a.account_code, a.account_name, a.account_type, a.is_system, a.is_active,
         a.pl_section, ag.group_code, ag.group_type
    FROM accounts a
    LEFT JOIN account_groups ag ON ag.id = a.account_group_id
   WHERE a.id = $1 AND a.business_id = $2
`;

/** Validates that `accountId` is an active operating-expense account for this business. */
export async function assertExpenseAccountForBusiness(
  businessId: string,
  accountId: string | null | undefined
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (accountId == null || accountId === '') {
    return {
      ok: false,
      response: NextResponse.json({ error: EXPENSE_ACCOUNT_REQUIRED, code: 'EXPENSE_ACCOUNT_REQUIRED' }, { status: 400 }),
    };
  }
  const row = await db.queryOne<PlAccountLike & { id: string; is_active: boolean }>(ACCOUNT_SQL, [accountId, businessId]);
  if (!row || row.is_active === false || !isOrdinaryOperatingExpenseAccount(row)) {
    return {
      ok: false,
      response: NextResponse.json({ error: EXPENSE_ACCOUNT_REJECTED, code: 'EXPENSE_ACCOUNT_REJECTED' }, { status: 400 }),
    };
  }
  return { ok: true };
}
