'use client';

import { useCallback } from 'react';
import type {
  OfflineActionType,
  OptimisticPatch,
  TenantScope,
} from '@/lib/offline/types';
import { offlineActionQueue } from '@/lib/offline/queue/offline-action-queue';
import { entityCacheRepository } from '@/lib/offline/repositories/entity-cache-repository';
import { useOfflineSync } from '@/contexts/OfflineSyncContext';
import { useAuth } from '@/contexts/AuthContext';
import { canQueueOfflineActions } from '@/lib/offline/connectivity/state-machine';

export interface OptimisticMutationOptions<TPayload extends Record<string, unknown>> {
  type: OfflineActionType;
  payload: TPayload;
  idempotencyKey?: string;
  optimisticPatches?: OptimisticPatch[];
  onApplied?: () => void;
  onQueued?: (actionId: string) => void;
}

/**
 * Queues a durable offline action and applies optimistic local patches immediately.
 */
export function useOptimisticMutation() {
  const { business, user } = useAuth();
  const { connectivity, refreshCounts, triggerSync } = useOfflineSync();

  const mutate = useCallback(
    async <TPayload extends Record<string, unknown>>(
      options: OptimisticMutationOptions<TPayload>
    ): Promise<{ queued: boolean; actionId?: string }> => {
      if (!business?.id || !user?.id) {
        throw new Error('Not authenticated');
      }

      const scope: TenantScope = {
        businessId: business.id,
        userId: user.id,
      };

      for (const patch of options.optimisticPatches ?? []) {
        const existing = await entityCacheRepository.getByKey(
          scope,
          patch.kind,
          patch.entityKey
        );
        const base =
          (existing?.data as Record<string, unknown> | undefined) ?? {};
        await entityCacheRepository.upsert(scope, patch.kind, patch.entityKey, {
          ...base,
          ...patch.patch,
        });
      }

      options.onApplied?.();

      if (!canQueueOfflineActions(connectivity.state)) {
        void triggerSync();
        return { queued: false };
      }

      const action = await offlineActionQueue.enqueue({
        scope,
        type: options.type,
        payload: options.payload,
        idempotencyKey: options.idempotencyKey,
        optimisticRefs:
          options.optimisticPatches?.map((p) => p.entityKey) ?? [],
      });

      await refreshCounts();
      options.onQueued?.(action.id);
      return { queued: true, actionId: action.id };
    },
    [business?.id, user?.id, connectivity.state, refreshCounts, triggerSync]
  );

  return { mutate };
}

export function useOfflineQueueCounts() {
  const { pendingActionCount, failedActionCount, isSyncing, triggerSync } =
    useOfflineSync();
  return { pendingActionCount, failedActionCount, isSyncing, triggerSync };
}
