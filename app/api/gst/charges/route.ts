import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { gstCalendarDateInTz } from '@/lib/gst/gst-calendar';
import { GSTR3BGenerator } from '@/lib/gst/gstr3b';
import { computeGstChargesFull } from '@/lib/gst/gst-charges-compute';
import {
  loadGstFilingOrgDefaults,
  mergeGstDueDateOptions,
  parseGstDueDateQueryOverrides,
} from '@/lib/gst/gst-org-filing';

/**
 * GET /api/gst/charges?period=YYYY-MM&branch_id=optional&filing_date=&payment_date=&is_nil_return=0|1&segment_details=1
 * Interest (delayed payment) and late fee (delayed filing) — separate from GST liability.
 * Segmented interest when ledger has `gst_payment` after due date.
 * `effective_interest_end_date` = min(max(filing/payment, last payment after due), `as_on_date`).
 * Query `as_on_date=YYYY-MM-DD` (optional) defaults to **today in Asia/Kolkata** — reproducible reports.
 */
export async function GET(request: NextRequest) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period');
    const branchIdParam = searchParams.get('branch_id');
    const filingDateParam = searchParams.get('filing_date');
    const paymentDateParam = searchParams.get('payment_date');
    const isNilParam = searchParams.get('is_nil_return');
    if (!period || !/^\d{4}-\d{2}$/.test(period.trim())) {
      return NextResponse.json({ error: 'period (YYYY-MM) is required' }, { status: 400 });
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam || undefined,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    try {
      await authorize(userId, 'journal', 'read', {
        businessId: business_id,
        branchId: finalBranchId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId,
        branchId: finalBranchId,
        feature: FeatureKeys.LEDGER_ACCOUNTING,
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    const gstPeriod = period.trim();
    const [ys, ms] = gstPeriod.split('-');
    const year = parseInt(ys, 10);
    const month = parseInt(ms, 10);
    const gen = new GSTR3BGenerator();
    const gstr3b = await gen.generate({
      business_id,
      month,
      year,
      branch_id: finalBranchId,
    });

    const today = gstCalendarDateInTz();
    const filingDate = filingDateParam?.trim().slice(0, 10) || today;
    const paymentDate = paymentDateParam?.trim().slice(0, 10) || filingDate;
    const isNilReturn =
      isNilParam === '1' || isNilParam === 'true'
        ? true
        : isNilParam === '0' || isNilParam === 'false'
          ? false
          : undefined;

    const segmentDetailsParam = searchParams.get('segment_details');
    const includeSegmentDetails = segmentDetailsParam !== '0' && segmentDetailsParam !== 'false';

    const asOnParam = searchParams.get('as_on_date')?.trim().slice(0, 10);
    if (asOnParam && !/^\d{4}-\d{2}-\d{2}$/.test(asOnParam)) {
      return NextResponse.json({ error: 'as_on_date must be YYYY-MM-DD' }, { status: 400 });
    }

    const org = await loadGstFilingOrgDefaults(business_id);
    const { override: dueDateOverride, due_date_inputs_from_request } =
      parseGstDueDateQueryOverrides(searchParams);
    const dueDateOptions = mergeGstDueDateOptions(org, dueDateOverride);

    const full = await computeGstChargesFull({
      businessId: business_id,
      branchId: finalBranchId,
      gstPeriod,
      netTaxPayable: Number(gstr3b.summary?.net_tax_payable ?? 0),
      filingDate,
      paymentDate,
      isNilReturn,
      dueDateOptions,
      ...(asOnParam ? { asOnDate: asOnParam } : {}),
    });

    return NextResponse.json({
      interest: full.interest,
      late_fee: full.late_fee,
      days_delayed: full.days_delayed,
      segmented: full.segmented,
      due_date: full.due_date,
      effective_interest_end_date: full.effective_interest_end_date,
      as_on_date: full.as_on_date,
      as_on_calendar_timezone: full.as_on_calendar_timezone,
      cash_liability_after_itc: full.cash_liability_after_itc,
      cash_liability_initial: full.cash_liability_initial,
      interest_days: full.interest_days,
      filing_frequency_used: dueDateOptions.filingFrequency ?? 'monthly',
      qrmp_due_day_used: dueDateOptions.filingFrequency === 'qrmp' ? dueDateOptions.qrmpDueDay : null,
      due_date_rule_source: due_date_inputs_from_request ? 'request_override' : 'org_defaults',
      warnings: full.warnings,
      ...(includeSegmentDetails
        ? { segments: full.segments, payment_events: full.payment_events }
        : {}),
    });
  } catch (error: any) {
    console.error('GST charges error:', error);
    return NextResponse.json({ error: error?.message || 'GST charges failed' }, { status: 500 });
  }
}
