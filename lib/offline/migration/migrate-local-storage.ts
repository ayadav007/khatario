import type { TenantScope } from '@/lib/offline/types';
import {
  loadCapabilitySnapshot,
  saveCapabilitySnapshot,
} from '@/lib/capability-snapshot';
import {
  loadDashboardSnapshot,
  type DashboardSnapshot,
} from '@/lib/dashboard-snapshot';
import { entityCacheRepository } from '@/lib/offline/repositories/entity-cache-repository';
import { appendSyncLog } from '@/lib/offline/observability/sync-log';
import { getOfflineDb } from '@/lib/offline/storage/indexed-db-client';

/**
 * One-time migration from Phase 1/2 localStorage snapshots into IndexedDB.
 */
export async function migrateLocalStorageToIndexedDb(
  scope: TenantScope
): Promise<{ migratedEntities: number }> {
  if (typeof window === 'undefined') {
    return { migratedEntities: 0 };
  }

  const flagKey = `khatario_offline_migrated_${scope.businessId}_${scope.userId}`;
  if (localStorage.getItem(flagKey) === '1') {
    return { migratedEntities: 0 };
  }

  let migrated = 0;

  try {
    await getOfflineDb();
  } catch {
    await appendSyncLog('warn', 'migration.skipped_no_idb', { scope });
    return { migratedEntities: 0 };
  }

  const capability = loadCapabilitySnapshot(scope.businessId, scope.userId);
  if (capability) {
    await entityCacheRepository.upsert(
      scope,
      'auth_session',
      'capability',
      capability as unknown as Record<string, unknown>,
      { syncedAt: capability.timestamp }
    );
    saveCapabilitySnapshot(capability);
    migrated += 1;
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith('offline_dashboard_')) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const snap = JSON.parse(raw) as DashboardSnapshot;
      if (snap.businessId !== scope.businessId || snap.userId !== scope.userId) {
        continue;
      }
      await entityCacheRepository.upsert(
        scope,
        'dashboard',
        `overview:${snap.dateRangeKey}`,
        snap.data,
        { syncedAt: snap.timestamp }
      );
      migrated += 1;
    } catch {
      /* skip invalid */
    }
  }

  localStorage.setItem(flagKey, '1');
  await appendSyncLog('info', 'migration.complete', { scope, migrated });
  return { migratedEntities: migrated };
}

export async function clearOfflineTenantData(scope: TenantScope): Promise<void> {
  const { offlineActionQueue } = await import(
    '@/lib/offline/queue/offline-action-queue'
  );
  const { draftRepository } = await import(
    '@/lib/offline/repositories/draft-repository'
  );
  await entityCacheRepository.clearTenant(scope);
  await offlineActionQueue.clearTenant(scope);
  const drafts = await draftRepository.list(scope);
  for (const d of drafts) {
    await draftRepository.remove(scope, d.formKey);
  }
}
