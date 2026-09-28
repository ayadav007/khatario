import { NextResponse } from 'next/server';
import { isPeriodLocked } from '@/lib/period-lock-utils';
import { assertGstPeriodNotFiledForDocumentDate } from '@/lib/gst/gst-filing';

function dateLabel(d: Date | string): string {
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
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
