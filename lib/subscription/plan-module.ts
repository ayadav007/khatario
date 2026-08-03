import { queryOne } from '@/lib/db';
import { productLineToModule, type PlatformModule } from '@/lib/platform-modules';
import { normalizeProductLine } from '@/lib/product-lines';
import { isTrialPlanId } from '@/lib/subscription/trial-plan';

export async function resolveModuleKeyForPlan(planId: string): Promise<PlatformModule> {
  const row = await queryOne<{ product_line: string | null }>(
    `SELECT product_line FROM subscription_plans WHERE id = $1`,
    [planId],
  );
  return productLineToModule(normalizeProductLine(row?.product_line));
}

export function productLineForModule(moduleKey: PlatformModule): string {
  if (moduleKey === 'hr') return 'hr';
  if (moduleKey === 'connect') return 'connect';
  return 'billing';
}

export function isTrialPlanForModule(planId: string, moduleKey: PlatformModule): boolean {
  if (!isTrialPlanId(planId)) return false;
  if (moduleKey === 'hr') return planId === 'hr_trial';
  if (moduleKey === 'billing') return planId === 'trial';
  return false;
}

export async function assertPlanMatchesModule(
  planId: string,
  moduleKey: PlatformModule,
): Promise<void> {
  const planModule = await resolveModuleKeyForPlan(planId);
  if (planModule !== moduleKey) {
    throw new Error(
      `Plan "${planId}" belongs to ${planModule}, not ${moduleKey}. Choose a plan for the correct product.`,
    );
  }
}
