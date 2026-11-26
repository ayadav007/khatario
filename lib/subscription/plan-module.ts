import type { PoolClient } from 'pg';
import { queryOne } from '@/lib/db';
import { productLineToModule, type PlatformModule } from '@/lib/platform-modules';
import { normalizeProductLine } from '@/lib/product-lines';
import { isTrialPlanId } from '@/lib/subscription/trial-plan';

/** With `client`, the read runs on that connection (inside the caller's transaction). */
export async function resolveModuleKeyForPlan(
  planId: string,
  client?: PoolClient,
): Promise<PlatformModule> {
  const sql = `SELECT product_line FROM subscription_plans WHERE id = $1`;
  const row = client
    ? ((await client.query<{ product_line: string | null }>(sql, [planId])).rows[0] ?? null)
    : await queryOne<{ product_line: string | null }>(sql, [planId]);
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
  client?: PoolClient,
): Promise<void> {
  const planModule = await resolveModuleKeyForPlan(planId, client);
  if (planModule !== moduleKey) {
    throw new Error(
      `Plan "${planId}" belongs to ${planModule}, not ${moduleKey}. Choose a plan for the correct product.`,
    );
  }
}
