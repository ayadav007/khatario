import { NextResponse } from 'next/server';
import { periodFilingOpensOn, returnPeriodForMonth } from '@/lib/gst/compliance/checks';
import { evaluateBusinessCompliance, syncComplianceAlerts } from '@/lib/gst/compliance/engine';
import { gstr3bDueDateIso } from '@/lib/gst/gst-interest';
import { loadGstFilingOrgDefaults, mergeGstDueDateOptions } from '@/lib/gst/gst-org-filing';
import {
  listReturnMarks,
  markReturnFiled,
  ReturnMarkInputError,
  unmarkReturnFiled,
  validateReturnMarkInput,
} from '@/lib/gst/compliance/return-marks';
import { gstComplianceGuard } from '@/lib/gst/compliance/route-guard';
import { todayIst } from '@/lib/gst/time-limits';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function refreshAlerts(businessId: string) {
  try {
    await syncComplianceAlerts(businessId, await evaluateBusinessCompliance(businessId), { notify: false });
  } catch (err) {
    console.error('[gst-return-marks] alert refresh failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * GET /api/gst/return-marks?for_month=YYYY-MM — the GSTR-3B return period containing that month
 * (its quarter for QRMP filers), its due date, and the mark if any.
 * GET /api/gst/return-marks?periods=2026-08,2026-09 — marks for those periods (latest 24 if omitted).
 */
export const GET = withPremiumSubscriptionApi({}, async ({ request, businessId, userId }) => {
  const denied = await gstComplianceGuard(userId, businessId);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const forMonth = params.get('for_month');
  if (forMonth) {
    if (!PERIOD_RE.test(forMonth)) return NextResponse.json({ error: 'for_month must be YYYY-MM' }, { status: 400 });
    const opts = mergeGstDueDateOptions(await loadGstFilingOrgDefaults(businessId));
    const rp = returnPeriodForMonth(forMonth, opts);
    const [mark] = await listReturnMarks(businessId, 'GSTR3B', [rp.period]);
    return NextResponse.json({
      period: rp.period,
      label: rp.label,
      filing_frequency: opts.filingFrequency ?? 'monthly',
      due_date: gstr3bDueDateIso(rp.period, opts),
      can_file_from: periodFilingOpensOn(rp.period),
      mark: mark ?? null,
    });
  }
  const periods = (params.get('periods') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => PERIOD_RE.test(p))
    .slice(0, 24);
  return NextResponse.json({ marks: await listReturnMarks(businessId, 'GSTR3B', periods) });
});

/**
 * POST /api/gst/return-marks  body: { period: 'YYYY-MM', filed_on?: 'YYYY-MM-DD', arn?: string }
 * Records that GSTR-3B was filed on the GST portal. Does not lock the period or touch the ledger
 * (POST /api/gst/file does that). For quarterly filers, period is the quarter's last month.
 */
export const POST = withPremiumSubscriptionApi({ parseJsonBody: true }, async ({ body, businessId, userId }) => {
  const denied = await gstComplianceGuard(userId, businessId);
  if (denied) return denied;
  const b = (body ?? {}) as Record<string, unknown>;
  try {
    const input = validateReturnMarkInput({ ...b, today: todayIst() });
    const mark = await markReturnFiled(businessId, userId, input);
    await refreshAlerts(businessId);
    return NextResponse.json({ mark });
  } catch (error) {
    if (error instanceof ReturnMarkInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[gst-return-marks] mark failed:', error);
    return NextResponse.json({ error: 'Could not mark the return as filed' }, { status: 500 });
  }
});

/** DELETE /api/gst/return-marks?period=YYYY-MM — undo a mistaken mark. */
export const DELETE = withPremiumSubscriptionApi({}, async ({ request, businessId, userId }) => {
  const denied = await gstComplianceGuard(userId, businessId);
  if (denied) return denied;
  const period = new URL(request.url).searchParams.get('period') ?? '';
  if (!PERIOD_RE.test(period)) return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 });
  const removed = await unmarkReturnFiled(businessId, 'GSTR3B', period);
  if (!removed) return NextResponse.json({ error: 'No filing mark for this period' }, { status: 404 });
  await refreshAlerts(businessId);
  return NextResponse.json({ success: true });
});
