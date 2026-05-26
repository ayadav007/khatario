/**
 * IndexedDB schema and store names for offline-first persistence.
 */

export const OFFLINE_DB_NAME = 'khatario_offline_v1';
export const OFFLINE_DB_VERSION = 1;

export const OFFLINE_STORES = {
  entities: 'entities',
  actions: 'actions',
  drafts: 'drafts',
  syncMeta: 'sync_meta',
  conflicts: 'conflicts',
  logs: 'logs',
} as const;

export type OfflineStoreName = (typeof OFFLINE_STORES)[keyof typeof OFFLINE_STORES];
