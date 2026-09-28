import { NextResponse } from 'next/server';
import { isPeriodLocked } from '@/lib/period-lock-utils';
import { assertGstPeriodNotFiledForDocumentDate } from '@/lib/gst/gst-filing';

function dateLabel(d: Date | string): string {
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

/** GST ledgers: input 1110-1112 (+ cess 1113), output 2150-2155, RCM and TDS/TCS under GST. */
const GST_ACCOUNT_CODES = ['1110', '1111', '1112', '1113', '2150', '2151', '2152', '2153', '2154', '2155'];

/** True when any of the accounts is a GST ledger, i.e. the voucher changes figures already reported in a return. */
export async function touchesGstAccounts(businessId: string, accountIds: string[]): Promise<boolean> {
  if (accountIds.length === 0) return false;
  const { queryOne } = await import('@/lib/db');
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM accounts
      WHERE business_id = $1 AND id = ANY($2::uuid[]) AND account_code = ANY($3::text[])`,
    [businessId, accountIds, GST_ACCOUNT_CODES]
  );
  return Number(row?.n || 0) > 0;
}

/**
 * Route-level check so users get 403 PERIOD_LOCKED / GST_PERIOD_FILED
 * instead of the raw 500 raised by the ledger period-lock trigger.
 */
export async function periodGuardResponse(params: {
  businessId: string;
  branchId: string | null;
  dates: Array<Date | string | null | undefined>;
  action: string;
  checkGstFiled?: boolean;
}): Promise<NextResponse | null> {
  for (const d of params.dates) {
    if (!d) continue;
    if (await isPeriodLocked(params.businessId, params.branchId, d)) {
      return NextResponse.json(
        {
          error: `Cannot ${params.action}: the period containing ${dateLabel(d)} is locked. Unlock it in Settings → Period locks first.`,
          code: 'PERIOD_LOCKED',
        },
        { status: 403 }
      );
    }
    if (params.checkGstFiled) {
      try {
        await assertGstPeriodNotFiledForDocumentDate(params.businessId, params.branchId, d, params.action);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : String(e), code: 'GST_PERIOD_FILED' },
          { status: 403 }
        );
      }
    }
  }
  return null;
}
