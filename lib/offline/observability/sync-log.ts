import type { SyncLogEntry } from '@/lib/offline/types';
import { getOfflineDb } from '@/lib/offline/storage/indexed-db-client';
import { OFFLINE_STORES } from '@/lib/offline/storage/schema';

const MAX_LOGS = 500;

function logId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function appendSyncLog(
  level: SyncLogEntry['level'],
  event: string,
  detail?: Record<string, unknown>
): Promise<void> {
  const entry: SyncLogEntry = {
    id: logId(),
    at: Date.now(),
    level,
    event,
    detail,
  };

  if (process.env.NODE_ENV !== 'production') {
    const prefix = `[OfflineSync:${level}] ${event}`;
    if (level === 'error') console.error(prefix, detail ?? '');
    else if (level === 'warn') console.warn(prefix, detail ?? '');
    else console.info(prefix, detail ?? '');
  }

  try {
    const db = await getOfflineDb();
    await db.put(OFFLINE_STORES.logs, entry);
    await trimLogs(db);
  } catch {
    /* non-fatal when IDB unavailable */
  }
}

async function trimLogs(db: Awaited<ReturnType<typeof getOfflineDb>>): Promise<void> {
  const tx = db.transaction(OFFLINE_STORES.logs, 'readwrite');
  const idx = tx.store.index('by-time');
  const all: SyncLogEntry[] = [];
  let cursor = await idx.openCursor(null, 'prev');
  while (cursor) {
    all.push(cursor.value);
    cursor = await cursor.continue();
  }
  if (all.length <= MAX_LOGS) {
    await tx.done;
    return;
  }
  const toDelete = all.slice(MAX_LOGS);
  for (const row of toDelete) {
    await tx.store.delete(row.id);
  }
  await tx.done;
}

export async function listSyncLogs(limit = 100): Promise<SyncLogEntry[]> {
  const db = await getOfflineDb();
  const tx = db.transaction(OFFLINE_STORES.logs, 'readonly');
  const idx = tx.store.index('by-time');
  const rows: SyncLogEntry[] = [];
  let cursor = await idx.openCursor(null, 'prev');
  while (cursor && rows.length < limit) {
    rows.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return rows;
}

export async function clearSyncLogs(): Promise<void> {
  const db = await getOfflineDb();
  await db.clear(OFFLINE_STORES.logs);
}
