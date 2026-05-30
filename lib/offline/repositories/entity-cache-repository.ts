import type {
  CachedEntityRecord,
  EntityKind,
  TenantScope,
} from '@/lib/offline/types';
import {
  entityId,
  getOfflineDb,
  tenantKey,
} from '@/lib/offline/storage/indexed-db-client';
import { OFFLINE_STORES } from '@/lib/offline/storage/schema';

export class EntityCacheRepository {
  async upsert<T>(
    scope: TenantScope,
    kind: EntityKind,
    entityKey: string,
    data: T,
    meta?: { serverVersion?: number | null; syncedAt?: number | null }
  ): Promise<CachedEntityRecord<T>> {
    const db = await getOfflineDb();
    const now = Date.now();
    const record: CachedEntityRecord<T> = {
      id: entityId(kind, scope.businessId, scope.userId, entityKey),
      kind,
      businessId: scope.businessId,
      userId: scope.userId,
      entityKey,
      data,
      serverVersion: meta?.serverVersion ?? null,
      updatedAt: now,
      syncedAt: meta?.syncedAt ?? now,
    };
    await db.put(OFFLINE_STORES.entities, record as CachedEntityRecord);
    return record;
  }

  async getByKey<T>(
    scope: TenantScope,
    kind: EntityKind,
    entityKey: string
  ): Promise<CachedEntityRecord<T> | null> {
    const db = await getOfflineDb();
    const id = entityId(kind, scope.businessId, scope.userId, entityKey);
    const row = await db.get(OFFLINE_STORES.entities, id);
    return (row as CachedEntityRecord<T> | undefined) ?? null;
  }

  async listByKind<T>(
    scope: TenantScope,
    kind: EntityKind,
    limit = 50
  ): Promise<CachedEntityRecord<T>[]> {
    const db = await getOfflineDb();
    const tx = db.transaction(OFFLINE_STORES.entities, 'readonly');
    const idx = tx.store.index('by-kind');
    const range = IDBKeyRange.only([
      scope.businessId,
      scope.userId,
      kind,
    ]);
    const rows: CachedEntityRecord<T>[] = [];
    let cursor = await idx.openCursor(range);
    while (cursor && rows.length < limit) {
      rows.push(cursor.value as CachedEntityRecord<T>);
      cursor = await cursor.continue();
    }
    await tx.done;
    return rows;
  }

  async clearTenant(scope: TenantScope): Promise<void> {
    const db = await getOfflineDb();
    const tx = db.transaction(OFFLINE_STORES.entities, 'readwrite');
    const idx = tx.store.index('by-tenant');
    const range = IDBKeyRange.only([scope.businessId, scope.userId]);
    let cursor = await idx.openCursor(range);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}

export const entityCacheRepository = new EntityCacheRepository();

export function dashboardEntityKey(dateRangeKey: string): string {
  return `overview:${dateRangeKey}`;
}

export async function saveDashboardCache(
  scope: TenantScope,
  dateRangeKey: string,
  data: Record<string, unknown>
): Promise<void> {
  await entityCacheRepository.upsert(
    scope,
    'dashboard',
    dashboardEntityKey(dateRangeKey),
    data
  );
}

export async function loadDashboardCache(
  scope: TenantScope,
  dateRangeKey: string
): Promise<CachedEntityRecord<Record<string, unknown>> | null> {
  return entityCacheRepository.getByKey(
    scope,
    'dashboard',
    dashboardEntityKey(dateRangeKey)
  );
}
