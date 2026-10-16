'use client';

import { useCapabilityCheck } from '@/hooks/useCapability';
import { hrPlanFlags, type HrPlanFlags } from '@/lib/subscription/hr-lite';

/** Per-area HR plan switches: Staff app, shifts, payroll setup, leave, portal and so on. */
export function useHrPlan(): HrPlanFlags {
  const { hasCapability } = useCapabilityCheck();
  return hrPlanFlags((key) => hasCapability(key, 'view'));
}
