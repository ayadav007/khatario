import { isCapacitorNative } from '@/lib/capacitor/platform';
import type { CatalogRepository } from '@/lib/offline/catalog/catalog-repository';
import { idbCatalogDriver } from '@/lib/offline/catalog/idb/idb-catalog-driver';
import {
  isSqliteCatalogAvailable,
  isSqliteCatalogInitFailed,
  resetSqliteCatalogInit,
  sqliteCatalogDriver,
} from '@/lib/offline/catalog/sqlite/sqlite-catalog-driver';

export type CatalogStorageBackend = 'sqlite' | 'indexeddb';

let cachedDriver: CatalogRepository | null = null;
let activeBackend: CatalogStorageBackend = 'indexeddb';

function markBackend(driver: CatalogRepository): CatalogRepository {
  cachedDriver = driver;
  activeBackend = driver === sqliteCatalogDriver ? 'sqlite' : 'indexeddb';
  return driver;
}

export function getActiveCatalogBackend(): CatalogStorageBackend {
  return activeBackend;
}

export async function getCatalogRepository(): Promise<CatalogRepository> {
  if (cachedDriver === idbCatalogDriver) {
    return cachedDriver;
  }

  if (cachedDriver === sqliteCatalogDriver) {
    if (isSqliteCatalogInitFailed() || !(await isSqliteCatalogAvailable())) {
      resetCatalogRepositoryCache();
    } else {
      return cachedDriver;
    }
  }

  if (isCapacitorNative() && (await isSqliteCatalogAvailable())) {
    return markBackend(sqliteCatalogDriver);
  }

  return markBackend(idbCatalogDriver);
}

/** Reset driver cache (tests or SQLite → IndexedDB fallback). */
export function resetCatalogRepositoryCache(): void {
  cachedDriver = null;
  activeBackend = 'indexeddb';
}

export const catalogService = {
  getRepository: getCatalogRepository,
};

const SQLITE_UNAVAILABLE = 'SQLite catalog unavailable';

/** Run catalog DB work; fall back to IndexedDB if native SQLite fails mid-flight. */
export async function withCatalogRepository<T>(
  fn: (repo: CatalogRepository) => Promise<T>
): Promise<T> {
  try {
    return await fn(await getCatalogRepository());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      isCapacitorNative() &&
      cachedDriver === sqliteCatalogDriver &&
      message.includes(SQLITE_UNAVAILABLE)
    ) {
      resetSqliteCatalogInit();
      resetCatalogRepositoryCache();
      return fn(idbCatalogDriver);
    }
    throw err;
  }
}
