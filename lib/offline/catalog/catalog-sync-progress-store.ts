'use client';

import type { CatalogSyncProgress } from '@/lib/offline/catalog/types';

type ProgressListener = () => void;

let progressSnapshot: CatalogSyncProgress | null = null;
const progressListeners = new Set<ProgressListener>();

/** External progress store — updates do not rerender CatalogSyncProvider children. */
export function getCatalogSyncProgressSnapshot(): CatalogSyncProgress | null {
  return progressSnapshot;
}

export function subscribeCatalogSyncProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

export function setCatalogSyncProgress(next: CatalogSyncProgress | null): void {
  progressSnapshot = next;
  for (const listener of progressListeners) {
    listener();
  }
}

export function resetCatalogSyncProgressStore(): void {
  progressSnapshot = null;
}
