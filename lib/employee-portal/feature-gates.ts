import { hasFeatureAccess, assertFeatureAccess } from '@/lib/subscription/feature-access';

export const ESS_FEATURE_GATES = {
  portal: 'hr_employee_portal',
  profile: 'hr_employees',
  attendance: 'hr_attendance',
  leaves: 'hr_leaves',
  payslips: 'hr_payroll',
  /** Primary HR gate; billing `purchase_expenses` still grants access for combo accounts. */
  expenses: 'hr_employees',
} as const;

export type EssModule = keyof typeof ESS_FEATURE_GATES;

export type EmployeePortalEntitlements = {
  portal: boolean;
  profile: boolean;
  attendance: boolean;
  leaves: boolean;
  payslips: boolean;
  expenses: boolean;
  team: boolean;
};

async function hasEssExpensesAccess(businessId: string): Promise<boolean> {
  const [hrEmployees, billingExpenses] = await Promise.all([
    hasFeatureAccess(businessId, ESS_FEATURE_GATES.expenses),
    hasFeatureAccess(businessId, 'purchase_expenses'),
  ]);
  return hrEmployees || billingExpenses;
}

export async function getEmployeePortalEntitlements(
  businessId: string
): Promise<EmployeePortalEntitlements> {
  const [portal, profile, attendance, leaves, payslips, expenses] = await Promise.all([
    hasFeatureAccess(businessId, ESS_FEATURE_GATES.portal),
    hasFeatureAccess(businessId, ESS_FEATURE_GATES.profile),
    hasFeatureAccess(businessId, ESS_FEATURE_GATES.attendance),
    hasFeatureAccess(businessId, ESS_FEATURE_GATES.leaves),
    hasFeatureAccess(businessId, ESS_FEATURE_GATES.payslips),
    hasEssExpensesAccess(businessId),
  ]);

  return {
    portal,
    profile,
    attendance,
    leaves,
    payslips,
    expenses,
    team: leaves || expenses,
  };
}

export async function assertEmployeePortalFeature(
  businessId: string,
  module: EssModule
): Promise<void> {
  if (module === 'expenses') {
    const allowed = await hasEssExpensesAccess(businessId);
    if (!allowed) {
      await assertFeatureAccess(businessId, ESS_FEATURE_GATES.expenses);
    }
    return;
  }
  await assertFeatureAccess(businessId, ESS_FEATURE_GATES[module]);
}
