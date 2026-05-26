import type {
  OfflineAction,
  OfflineActionStatus,
  OfflineActionType,
  TenantScope,
  ConflictStrategy,
} from '@/lib/offline/types';
import { DEFAULT_CONFLICT_STRATEGY } from '@/lib/offline/types';
import { getOfflineDb, tenantKey } from '@/lib/offline/storage/indexed-db-client';
import { OFFLINE_STORES } from '@/lib/offline/storage/schema';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `offline_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class OfflineActionQueue {
  private sequenceCache = new Map<string, number>();

  private async nextSequence(scope: TenantScope): Promise<number> {
    const key = tenantKey(scope.businessId, scope.userId);
    const cached = this.sequenceCache.get(key);
    if (cached != null) {
      const next = cached + 1;
      this.sequenceCache.set(key, next);
      return next;
    }

    const pending = await this.list(scope, ['pending', 'processing', 'failed']);
    const maxSeq = pending.reduce((max, a) => Math.max(max, a.sequence), 0);
    const next = maxSeq + 1;
    this.sequenceCache.set(key, next);
    return next;
  }

  async enqueue<TPayload extends Record<string, unknown>>(input: {
    scope: TenantScope;
    type: OfflineActionType;
    payload: TPayload;
    idempotencyKey?: string;
    optimisticRefs?: string[];
    conflictStrategy?: ConflictStrategy;
  }): Promise<OfflineAction<TPayload>> {
    const db = await getOfflineDb();
    const now = Date.now();
    const sequence = await this.nextSequence(input.scope);
    const action: OfflineAction<TPayload> = {
      id: generateId(),
      businessId: input.scope.businessId,
      userId: input.scope.userId,
      type: input.type,
      payload: input.payload,
      idempotencyKey:
        input.idempotencyKey ??
        `${input.type}:${input.scope.businessId}:${now}:${sequence}`,
      sequence,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      lastError: null,
      optimisticRefs: input.optimisticRefs ?? [],
      conflictStrategy:
        input.conflictStrategy ?? DEFAULT_CONFLICT_STRATEGY[input.type],
    };
    await db.put(OFFLINE_STORES.actions, action as OfflineAction);
    return action;
  }

  async list(
    scope: TenantScope,
    statuses?: OfflineActionStatus[]
  ): Promise<OfflineAction[]> {
    const db = await getOfflineDb();
    const tx = db.transaction(OFFLINE_STORES.actions, 'readonly');
    const idx = tx.store.index('by-sequence');
    const range = IDBKeyRange.bound(
      [scope.businessId, scope.userId, 0],
      [scope.businessId, scope.userId, Number.MAX_SAFE_INTEGER]
    );

    const rows: OfflineAction[] = [];
    let cursor = await idx.openCursor(range);
    while (cursor) {
      const action = cursor.value;
      if (!statuses || statuses.includes(action.status)) {
        rows.push(action);
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return rows.sort((a, b) => a.sequence - b.sequence);
  }

  async countByStatus(
    scope: TenantScope,
    status: OfflineActionStatus
  ): Promise<number> {
    const rows = await this.list(scope, [status]);
    return rows.length;
  }

  async updateStatus(
    actionId: string,
    status: OfflineActionStatus,
    patch?: Partial<Pick<OfflineAction, 'lastError' | 'attempts'>>
  ): Promise<void> {
    const db = await getOfflineDb();
    const existing = await db.get(OFFLINE_STORES.actions, actionId);
    if (!existing) return;
    await db.put(OFFLINE_STORES.actions, {
      ...existing,
      ...patch,
      status,
      updatedAt: Date.now(),
    });
  }

  async retryAction(actionId: string): Promise<void> {
    const db = await getOfflineDb();
    const existing = await db.get(OFFLINE_STORES.actions, actionId);
    if (!existing) return;
    if (existing.status !== 'failed' && existing.status !== 'manual_review') {
      return;
    }
    await db.put(OFFLINE_STORES.actions, {
      ...existing,
      status: 'pending',
      lastError: null,
      updatedAt: Date.now(),
    });
  }

  async markProcessing(actionId: string): Promise<void> {
    const db = await getOfflineDb();
    const existing = await db.get(OFFLINE_STORES.actions, actionId);
    if (!existing) return;
    await db.put(OFFLINE_STORES.actions, {
      ...existing,
      status: 'syncing',
      attempts: existing.attempts + 1,
      updatedAt: Date.now(),
    });
  }

  async removeCompleted(scope: TenantScope, olderThanMs = 7 * 86400000): Promise<number> {
    const db = await getOfflineDb();
    const all = await this.list(scope);
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const action of all) {
      if (action.status === 'completed' && action.updatedAt < cutoff) {
        await db.delete(OFFLINE_STORES.actions, action.id);
        removed += 1;
      }
    }
    return removed;
  }

  async clearTenant(scope: TenantScope): Promise<void> {
    const db = await getOfflineDb();
    const all = await this.list(scope);
    const tx = db.transaction(OFFLINE_STORES.actions, 'readwrite');
    for (const action of all) {
      await tx.store.delete(action.id);
    }
    await tx.done;
    this.sequenceCache.delete(tenantKey(scope.businessId, scope.userId));
  }
}

export const offlineActionQueue = new OfflineActionQueue();
