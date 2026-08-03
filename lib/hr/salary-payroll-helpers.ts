/**
 * Payroll helpers: pro-rata salary and advance recovery installments.
 */

export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Inclusive calendar days between two yyyy-MM-dd dates. */
export function inclusiveCalendarDays(fromYmd: string, toYmd: string): number {
  const from = parseDateOnly(fromYmd);
  const to = parseDateOnly(toYmd);
  const diffMs = to.getTime() - from.getTime();
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / 86_400_000) + 1;
}

export interface ProRataSalaryResult {
  applied: boolean;
  proratedAmount: number;
  fullMonthlySalary: number;
  effectiveFrom: string;
  effectiveTo: string;
  daysInPeriod: number;
  daysPaid: number;
  joiningDate: string | null;
}

/**
 * Pro-rate monthly salary when the employee joined mid pay period.
 * Uses calendar-day ratio over the selected from/to range.
 */
export function computeProRataMonthlySalary(params: {
  monthlySalary: number;
  periodFrom: string;
  periodTo: string;
  joiningDate?: string | null;
}): ProRataSalaryResult {
  const { monthlySalary, periodFrom, periodTo, joiningDate } = params;
  const fullMonthlySalary = Number(monthlySalary) || 0;
  const daysInPeriod = inclusiveCalendarDays(periodFrom, periodTo);

  const base: ProRataSalaryResult = {
    applied: false,
    proratedAmount: fullMonthlySalary,
    fullMonthlySalary,
    effectiveFrom: periodFrom,
    effectiveTo: periodTo,
    daysInPeriod,
    daysPaid: daysInPeriod,
    joiningDate: joiningDate ?? null,
  };

  if (fullMonthlySalary <= 0 || daysInPeriod <= 0 || !joiningDate?.trim()) {
    return base;
  }

  const join = joiningDate.trim().slice(0, 10);
  if (join <= periodFrom) {
    return base;
  }
  if (join > periodTo) {
    return {
      ...base,
      applied: true,
      proratedAmount: 0,
      effectiveFrom: join,
      daysPaid: 0,
    };
  }

  const daysPaid = inclusiveCalendarDays(join, periodTo);
  const proratedAmount =
    Math.round(((fullMonthlySalary * daysPaid) / daysInPeriod) * 100) / 100;

  return {
    applied: true,
    proratedAmount,
    fullMonthlySalary,
    effectiveFrom: join,
    effectiveTo: periodTo,
    daysInPeriod,
    daysPaid,
    joiningDate: join,
  };
}

export interface AdvanceForRecoverySuggestion {
  id: string;
  remaining_amount: number;
  recovery_months?: number | null;
  recoveries_done: number;
}

export interface AdvanceRecoverySuggestion {
  advance_id: string;
  remaining_amount: number;
  recovery_months: number | null;
  recoveries_done: number;
  suggested_installment: number;
  plan_label: string | null;
}

/** Suggested installment for one advance (respects recovery_months split). */
export function suggestInstallmentForAdvance(
  advance: AdvanceForRecoverySuggestion
): number {
  const remaining = Number(advance.remaining_amount) || 0;
  if (remaining <= 0) return 0;

  const months = advance.recovery_months;
  if (!months || months < 1) {
    return remaining;
  }

  const done = Math.max(0, Number(advance.recoveries_done) || 0);
  const monthsLeft = Math.max(1, months - done);
  const installment = Math.ceil((remaining / monthsLeft) * 100) / 100;
  return Math.min(remaining, installment);
}

export function buildAdvancePlanLabel(
  advance: AdvanceForRecoverySuggestion,
  suggestedInstallment: number
): string | null {
  const months = advance.recovery_months;
  if (!months || months < 1) return null;
  const done = Math.max(0, Number(advance.recoveries_done) || 0);
  const monthIndex = done + 1;
  return `${months}-month plan: ₹${suggestedInstallment.toLocaleString('en-IN')} (month ${monthIndex} of ${months})`;
}

export function suggestAdvanceRecoveries(
  advances: AdvanceForRecoverySuggestion[],
  capAmount?: number | null
): {
  suggested_total: number;
  breakdown: AdvanceRecoverySuggestion[];
} {
  const breakdown: AdvanceRecoverySuggestion[] = [];
  let suggestedTotal = 0;

  for (const advance of advances) {
    const suggested_installment = suggestInstallmentForAdvance(advance);
    breakdown.push({
      advance_id: advance.id,
      remaining_amount: Number(advance.remaining_amount) || 0,
      recovery_months: advance.recovery_months ?? null,
      recoveries_done: advance.recoveries_done,
      suggested_installment,
      plan_label: buildAdvancePlanLabel(advance, suggested_installment),
    });
    suggestedTotal += suggested_installment;
  }

  if (capAmount != null && capAmount >= 0 && suggestedTotal > capAmount) {
    suggestedTotal = capAmount;
  }

  return { suggested_total: suggestedTotal, breakdown };
}

export function isPartialAdvanceRecovery(
  recoveryAmount: number,
  pendingBalance: number
): boolean {
  const recovery = Number(recoveryAmount) || 0;
  const pending = Number(pendingBalance) || 0;
  return recovery > 0 && pending > 0 && recovery < pending;
}

export function defaultPartialRecoveryNote(params: {
  recovered: number;
  pendingBefore: number;
  paymentDate: string;
}): string {
  const remaining = Math.max(0, params.pendingBefore - params.recovered);
  return `Partial recovery ₹${params.recovered.toLocaleString('en-IN')} of ₹${params.pendingBefore.toLocaleString('en-IN')} pending — ₹${remaining.toLocaleString('en-IN')} deferred (salary ${params.paymentDate}).`;
}
