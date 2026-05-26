import type { SyncMetaRecord, TenantScope } from '@/lib/offline/types';
import { getOfflineDb, tenantKey } from '@/lib/offline/storage/indexed-db-client';
import { OFFLINE_STORES } from '@/lib/offline/storage/schema';
import { offlineActionQueue } from '@/lib/offline/queue/offline-action-queue';

export async function getSyncMeta(scope: TenantScope): Promise<SyncMetaRecord> {
  const db = await getOfflineDb();
  const id = tenantKey(scope.businessId, scope.userId);
  const existing = await db.get(OFFLINE_STORES.syncMeta, id);
  if (existing) return existing;

  const meta: SyncMetaRecord = {
    id,
    businessId: scope.businessId,
    userId: scope.userId,
    lastSuccessfulSyncAt: null,
    lastAttemptAt: null,
    pendingActionCount: 0,
    failedActionCount: 0,
  };
  await db.put(OFFLINE_STORES.syncMeta, meta);
  return meta;
}

export async function refreshSyncMetaCounts(scope: TenantScope): Promise<SyncMetaRecord> {
  const db = await getOfflineDb();
  const id = tenantKey(scope.businessId, scope.userId);
  const pending = await offlineActionQueue.countByStatus(scope, 'pending');
  const failed = await offlineActionQueue.countByStatus(scope, 'failed');
  const manualReview = await offlineActionQueue.countByStatus(scope, 'manual_review');
  const meta = await getSyncMeta(scope);
  const updated: SyncMetaRecord = {
    ...meta,
    pendingActionCount: pending,
    failedActionCount: failed + manualReview,
  };
  await db.put(OFFLINE_STORES.syncMeta, updated);
  return updated;
}

export async function markSyncSuccess(scope: TenantScope): Promise<void> {
  const db = await getOfflineDb();
  const meta = await refreshSyncMetaCounts(scope);
  await db.put(OFFLINE_STORES.syncMeta, {
    ...meta,
    lastSuccessfulSyncAt: Date.now(),
    lastAttemptAt: Date.now(),
  });
}

export async function markSyncAttempt(scope: TenantScope): Promise<void> {
  const db = await getOfflineDb();
  const meta = await getSyncMeta(scope);
  await db.put(OFFLINE_STORES.syncMeta, {
    ...meta,
    lastAttemptAt: Date.now(),
  });
}
