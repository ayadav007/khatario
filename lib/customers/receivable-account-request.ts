import { NextResponse } from 'next/server';
import { ReceivableAccountError } from '@/lib/accounting/receivable-accounts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * The `receivable_account_id` of a request body: an account id, or null for the control account.
 * Anything else is refused before it reaches a query.
 */
export function parseReceivableAccountId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isUuid(value)) {
    throw new ReceivableAccountError(
      'Choose Accounts Receivable or an active account under it.',
      'RECEIVABLE_ACCOUNT_INVALID',
    );
  }
  return value;
}

export function receivableAccountErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ReceivableAccountError)) return null;
  return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
}
