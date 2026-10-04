/**
 * Client-safe HR Lite helpers. Do not import lib/db here — settings nav and
 * sidebar run in the browser.
 */

import { HR_STAFF_LITE_PLAN_ID } from '@/lib/product-lines';

/** Whether an HR plan id is the complimentary Staff Lite tier. */
export function isHrStaffLitePlanId(planId: string | null | undefined): boolean {
  return planId === HR_STAFF_LITE_PLAN_ID;
}

/**
 * Full HR suite (leave / portal / advanced IA) vs Billing-bundled Lite.
 * Lite has employees + attendance + simple payroll only.
 */
export function hasFullHrFeatures(hasFeature: (featureKey: string) => boolean): boolean {
  return hasFeature('hr_leaves') || hasFeature('hr_employee_portal');
}
