/**
 * Maps HR PBAC module keys (and capability check strings) to Feature Registry IDs
 * used in subscription_plan_features / enabledFeatures.
 */

export type HrRegistryFeatureId =
  | 'hr_employees'
  | 'hr_attendance'
  | 'hr_payroll'
  | 'hr_leaves';

const HR_AUTH_MODULE_TO_FEATURE: Record<string, HrRegistryFeatureId> = {
  employees: 'hr_employees',
  payroll: 'hr_payroll',
  attendance: 'hr_attendance',
  leaves: 'hr_leaves',
  leave_requests: 'hr_leaves',
  commissions: 'hr_employees',
};

/** Registry IDs for HR (also valid capability / sidebar keys). */
const HR_REGISTRY_IDS = new Set<string>([
  'hr_employees',
  'hr_attendance',
  'hr_payroll',
  'hr_leaves',
]);

/**
 * For server authorize(): moduleKey as passed to authorize() (e.g. employees, payroll).
 */
export function getHrRegistryFeatureForAuthModule(moduleKey: string): HrRegistryFeatureId | null {
  return HR_AUTH_MODULE_TO_FEATURE[moduleKey] ?? null;
}

/**
 * For client hasCapability(resource): resource may be module name, alias, or hr_* registry id.
 */
export function getHrPlanFeatureForCapabilityCheck(resource: string): HrRegistryFeatureId | null {
  if (HR_REGISTRY_IDS.has(resource)) {
    return resource as HrRegistryFeatureId;
  }
  return HR_AUTH_MODULE_TO_FEATURE[resource] ?? null;
}
