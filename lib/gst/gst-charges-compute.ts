import { GST_DEFAULT_CALENDAR_TIMEZONE, gstCalendarDateInTz } from '@/lib/gst/gst-calendar';
import { round2 } from '@/lib/gst/gstr3b-ledger';
import {
  calculateInterest,
  computeGstChargesEstimate,
  computeSegmentedGstInterest,
  gstCashLiabilityAfterItcForInterest,
  isLikelyNilGstr3BReturn,
  toIsoDateOnly,
  wholeDaysLate,
  type GstInterestSegmentRow,
  type Gstr3BDueDateOptions,
} from '@/lib/gst/gst-interest';
import type { GstPaymentEvent } from '@/lib/gst/gst-settlement';
import { getGstPaymentEvents, getOutstandingGst } from '@/lib/gst/gst-settlement';

function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}

function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export interface ComputeGstChargesFullParams {
  businessId: string;
  branchId: string;
  gstPeriod: string;
  netTaxPayable: number;
  filingDate: string;
  paymentDate: string;
  isNilReturn?: boolean;
  dueDateOptions?: Gstr3BDueDateOptions;
  /**
   * Cap interest / challan visibility at this date (YYYY-MM-DD). Defaults to **today** in
   * {@link GST_DEFAULT_CALENDAR_TIMEZONE} (IST for India).
   */
  asOnDate?: string;
}

export interface ComputeGstChargesFullResult {
  interest: number;
  late_fee: number;
  days_delayed: number;
  due_date: string;
  interest_days: number;
  /**
   * `min(max(max(filing,payment), lastPaymentAfterDue), as_on_date)` — reproducible interest horizon.
   */
  effective_interest_end_date: string;
  /** Date-only cap; default “today” uses IST calendar unless `asOnDate` was explicit. */
  as_on_date: string;
  /** IANA zone used for default `as_on_date` (explicit `asOnDate` is still date-only). */
  as_on_calendar_timezone: string;
  /** GSTR-3B `summary.net_tax_payable` (post–ITC working). */
  cash_liability_after_itc: number;
  /** `getOutstandingGst` total on **due date** — principal for segmented interest. */
  cash_liability_initial: number;
  segmented: boolean;
  segments: GstInterestSegmentRow[];
  payment_events: GstPaymentEvent[];
  warnings: string[];
}

/**
 * Late fee + interest with optional **segmented** interest when `gst_payment` rows exist after due date.
 * Falls back to the legacy single-interval formula when there are no such payments (flag `segmented: false`).
 *
 * **Cross-period:** `cash_liability_initial` uses `getOutstandingGst` on the due date and may include
 * other months’ unpaid balances until you add period-scoped tagging.
 */
export async function computeGstChargesFull(
  params: ComputeGstChargesFullParams
): Promise<ComputeGstChargesFullResult> {
  const { businessId, branchId, gstPeriod, netTaxPayable, filingDate, paymentDate } = params;
  const filingIso = toIsoDateOnly(filingDate);
  const paymentIso = toIsoDateOnly(paymentDate);
  const asOnIso =
    params.asOnDate != null && String(params.asOnDate).trim() !== ''
      ? toIsoDateOnly(String(params.asOnDate).trim())
      : gstCalendarDateInTz(new Date(), GST_DEFAULT_CALENDAR_TIMEZONE);
  const cash3b = gstCashLiabilityAfterItcForInterest(netTaxPayable);
  const nil =
    params.isNilReturn !== undefined
      ? params.isNilReturn
      : isLikelyNilGstr3BReturn(netTaxPayable);

  const filingCapped = minIsoDate(filingIso, asOnIso);
  const paymentCapped = minIsoDate(paymentIso, asOnIso);

  const base = computeGstChargesEstimate({
    gstPeriod,
    netTaxPayable,
    filingDate: filingCapped,
    paymentDate: paymentCapped,
    isNilReturn: nil,
    dueDateOptions: params.dueDateOptions,
  });

  const due = base.due_date;
  const userInterestEnd = maxIsoDate(filingIso, paymentIso);

  const obAtDue = await getOutstandingGst({
    businessId,
    branchId,
    asOnDate: due,
  });
  const initialLedger = round2(Math.max(0, obAtDue.total_liability));

  /** Ledger payments after due, through as-on only (ignores future-dated rows beyond as_on). */
  const payment_events_raw = await getGstPaymentEvents({
    businessId,
    branchId,
    afterDateExclusive: due,
    uptoDate: asOnIso,
  });

  const lastPayDate =
    payment_events_raw.length > 0 ? payment_events_raw[payment_events_raw.length - 1].date : null;
  const candidate =
    lastPayDate != null ? maxIsoDate(userInterestEnd, lastPayDate) : userInterestEnd;
  const effectiveInterestEnd = minIsoDate(candidate, asOnIso);

  const payment_events = payment_events_raw.filter((e) => e.date <= effectiveInterestEnd);

  const eventsAfterDue = payment_events.filter((e) => e.date > due);
  const warnings: string[] = [];
  let segmented = false;
  let interest = base.interest;
  let segments: GstInterestSegmentRow[] = [];

  if (eventsAfterDue.length > 0) {
    segmented = true;
    const seg = computeSegmentedGstInterest({
      dueDate: due,
      initialCashLiability: initialLedger,
      paymentEvents: eventsAfterDue,
      interestEndDate: effectiveInterestEnd,
    });
    interest = seg.totalInterest;
    segments = seg.segments;
  } else {
    interest = calculateInterest({
      cashLiabilityAfterItc: cash3b,
      dueDate: due,
      paymentDate: paymentCapped,
    });
    if (wholeDaysLate(due, paymentCapped) > 0) {
      warnings.push('Interest estimated without payment segmentation');
    }
  }

  return {
    interest,
    late_fee: base.late_fee,
    days_delayed: base.days_delayed,
    due_date: due,
    interest_days: base.interest_days,
    effective_interest_end_date: effectiveInterestEnd,
    as_on_date: asOnIso,
    as_on_calendar_timezone: GST_DEFAULT_CALENDAR_TIMEZONE,
    cash_liability_after_itc: cash3b,
    cash_liability_initial: initialLedger,
    segmented,
    segments,
    payment_events,
    warnings,
  };
}
