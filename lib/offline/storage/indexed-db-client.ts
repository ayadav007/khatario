import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  CachedEntityRecord,
  ConflictRecord,
  FormDraftRecord,
  OfflineAction,
  SyncLogEntry,
  SyncMetaRecord,
} from '@/lib/offline/types';
import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_STORES,
} from '@/lib/offline/storage/schema';

interface KhatarioOfflineDB extends DBSchema {
  [OFFLINE_STORES.entities]: {
    key: string;
    value: CachedEntityRecord;
    indexes: {
      'by-tenant': [string, string];
      'by-kind': [string, string, string];
    };
  };
  [OFFLINE_STORES.actions]: {
    key: string;
    value: OfflineAction;
    indexes: {
      'by-tenant-status': [string, string, string];
      'by-sequence': [string, string, number];
    };
  };
  [OFFLINE_STORES.drafts]: {
    key: string;
    value: FormDraftRecord;
    indexes: { 'by-tenant': [string, string] };
  };
  [OFFLINE_STORES.syncMeta]: {
    key: string;
    value: SyncMetaRecord;
  };
  [OFFLINE_STORES.conflicts]: {
    key: string;
    value: ConflictRecord;
  };
  [OFFLINE_STORES.logs]: {
    key: string;
    value: SyncLogEntry;
    indexes: { 'by-time': number };
  };
}

let dbPromise: Promise<IDBPDatabase<KhatarioOfflineDB>> | null = null;

export function tenantKey(businessId: string, userId: string): string {
  return `${businessId}:${userId}`;
}

export function entityId(
  kind: string,
  businessId: string,
  userId: string,
  entityKey: string
): string {
  return `${kind}:${businessId}:${userId}:${entityKey}`;
}

export async function getOfflineDb(): Promise<IDBPDatabase<KhatarioOfflineDB>> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this environment');
  }

  if (!dbPromise) {
    dbPromise = openDB<KhatarioOfflineDB>(OFFLINE_DB_NAME, OFFLINE_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(OFFLINE_STORES.entities)) {
          const store = db.createObjectStore(OFFLINE_STORES.entities, {
            keyPath: 'id',
          });
          store.createIndex('by-tenant', ['businessId', 'userId']);
          store.createIndex('by-kind', ['businessId', 'userId', 'kind']);
        }

        if (!db.objectStoreNames.contains(OFFLINE_STORES.actions)) {
          const store = db.createObjectStore(OFFLINE_STORES.actions, {
            keyPath: 'id',
          });
          store.createIndex('by-tenant-status', [
            'businessId',
            'userId',
            'status',
          ]);
          store.createIndex('by-sequence', ['businessId', 'userId', 'sequence']);
        }

        if (!db.objectStoreNames.contains(OFFLINE_STORES.drafts)) {
          const store = db.createObjectStore(OFFLINE_STORES.drafts, {
            keyPath: 'id',
          });
          store.createIndex('by-tenant', ['businessId', 'userId']);
        }

        if (!db.objectStoreNames.contains(OFFLINE_STORES.syncMeta)) {
          db.createObjectStore(OFFLINE_STORES.syncMeta, { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains(OFFLINE_STORES.conflicts)) {
          db.createObjectStore(OFFLINE_STORES.conflicts, { keyPath: 'actionId' });
        }

        if (!db.objectStoreNames.contains(OFFLINE_STORES.logs)) {
          const store = db.createObjectStore(OFFLINE_STORES.logs, {
            keyPath: 'id',
          });
          store.createIndex('by-time', 'at');
        }
      },
    });
  }

  return dbPromise;
}

export async function resetOfflineDbForTests(): Promise<void> {
  dbPromise = null;
}
