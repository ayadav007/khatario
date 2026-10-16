/**
 * Client-safe HR Lite helpers. Do not import lib/db here — settings nav and
 * sidebar run in the browser.
 */

import { HR_STAFF_LITE_PLAN_ID } from '@/lib/product-lines';

/** Whether an HR plan id is the complimentary Staff Lite tier. */
export function isHrStaffLitePlanId(planId: string | null | undefined): boolean {
  return planId === HR_STAFF_LITE_PLAN_ID;
}

/** Which optional HR areas the plan includes (one switch each in Admin › Plans). */
export type HrPlanFlags = {
  staffApp: boolean;
  shifts: boolean;
  payrollSetup: boolean;
  commissions: boolean;
  leaves: boolean;
  portal: boolean;
  recruitment: boolean;
  advanced: boolean;
};

export function hrPlanFlags(hasFeature: (featureKey: string) => boolean): HrPlanFlags {
  return {
    staffApp: hasFeature('hr_staff_app'),
    shifts: hasFeature('hr_shifts'),
    payrollSetup: hasFeature('hr_payroll_setup'),
    commissions: hasFeature('hr_commissions'),
    leaves: hasFeature('hr_leaves'),
    portal: hasFeature('hr_employee_portal'),
    recruitment: hasFeature('hr_recruitment'),
    advanced: hasFeature('hr_advanced'),
  };
}

/** Anything beyond the free HR Lite (employees, attendance, salary). */
export function isBeyondHrLite(hasFeature: (featureKey: string) => boolean): boolean {
  return Object.values(hrPlanFlags(hasFeature)).some(Boolean);
}
