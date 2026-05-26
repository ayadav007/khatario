import type { TenantScope } from '@/lib/offline/types';
import { entityCacheRepository } from '@/lib/offline/repositories/entity-cache-repository';

export interface CustomerBalanceSnapshot {
  customerId: string;
  serverBalance: number | null;
  optimisticDelta: number;
  effectiveBalance: number | null;
  lastUpdated: number;
}

const CUSTOMER_KIND = 'customer' as const;

export async function getCustomerBalanceSnapshot(
  scope: TenantScope,
  customerId: string
): Promise<CustomerBalanceSnapshot> {
  const cached = await entityCacheRepository.getByKey(scope, CUSTOMER_KIND, customerId);
  const data = (cached?.data as Record<string, unknown>) ?? {};
  const serverBalance =
    typeof data.current_balance === 'number' ? data.current_balance : null;
  const optimisticDelta =
    typeof data.offline_balance_delta === 'number' ? data.offline_balance_delta : 0;
  const effectiveBalance =
    serverBalance != null ? serverBalance + optimisticDelta : null;

  return {
    customerId,
    serverBalance,
    optimisticDelta,
    effectiveBalance,
    lastUpdated: cached?.updatedAt ?? Date.now(),
  };
}

/** Optimistically increase receivable when queuing a credit sale offline. */
export async function applyOptimisticCustomerBalance(input: {
  scope: TenantScope;
  customerId: string;
  balanceDelta: number;
  invoiceReference?: string;
}): Promise<void> {
  const existing = await entityCacheRepository.getByKey(
    input.scope,
    CUSTOMER_KIND,
    input.customerId
  );
  const base = (existing?.data as Record<string, unknown>) ?? {
    id: input.customerId,
  };
  const prevDelta =
    typeof base.offline_balance_delta === 'number' ? base.offline_balance_delta : 0;
  const refs = (base.offline_invoice_refs as string[]) ?? [];
  if (input.invoiceReference && !refs.includes(input.invoiceReference)) {
    refs.push(input.invoiceReference);
  }
  await entityCacheRepository.upsert(
    input.scope,
    CUSTOMER_KIND,
    input.customerId,
    {
      ...base,
      offline_balance_delta: prevDelta + input.balanceDelta,
      offline_invoice_refs: refs,
      current_balance:
        typeof base.current_balance === 'number'
          ? base.current_balance + input.balanceDelta
          : base.current_balance,
    }
  );
}

export async function clearOptimisticCustomerDelta(input: {
  scope: TenantScope;
  customerId: string;
  invoiceReference?: string;
}): Promise<void> {
  const existing = await entityCacheRepository.getByKey(
    input.scope,
    CUSTOMER_KIND,
    input.customerId
  );
  if (!existing) return;
  const base = existing.data as Record<string, unknown>;
  await entityCacheRepository.upsert(input.scope, CUSTOMER_KIND, input.customerId, {
    ...base,
    offline_balance_delta: 0,
    offline_invoice_refs: [],
  });
}

/** Detect major balance drift after replay — caller may route to manual_review. */
export function detectCustomerBalanceConflict(input: {
  serverBalanceBefore: number | null;
  serverBalanceAfter: number;
  expectedDelta: number;
  tolerance?: number;
}): { conflict: boolean; reason?: string } {
  if (input.serverBalanceBefore == null) {
    return { conflict: false };
  }
  const tolerance = input.tolerance ?? 0.05;
  const actualDelta = input.serverBalanceAfter - input.serverBalanceBefore;
  if (Math.abs(actualDelta - input.expectedDelta) > tolerance) {
    return {
      conflict: true,
      reason: `Customer balance changed unexpectedly (expected +${input.expectedDelta}, got +${actualDelta})`,
    };
  }
  return { conflict: false };
}
