import { isCapacitorNative } from '@/lib/capacitor/platform';
import type { CatalogRepository } from '@/lib/offline/catalog/catalog-repository';
import { idbCatalogDriver } from '@/lib/offline/catalog/idb/idb-catalog-driver';
import {
  isSqliteCatalogAvailable,
  sqliteCatalogDriver,
} from '@/lib/offline/catalog/sqlite/sqlite-catalog-driver';

let cachedDriver: CatalogRepository | null = null;

export async function getCatalogRepository(): Promise<CatalogRepository> {
  if (cachedDriver) return cachedDriver;
  if (isCapacitorNative() && (await isSqliteCatalogAvailable())) {
    cachedDriver = sqliteCatalogDriver;
    return cachedDriver;
  }
  cachedDriver = idbCatalogDriver;
  return cachedDriver;
}

/** Reset driver cache (tests). */
export function resetCatalogRepositoryCache(): void {
  cachedDriver = null;
}

export const catalogService = {
  getRepository: getCatalogRepository,
};
