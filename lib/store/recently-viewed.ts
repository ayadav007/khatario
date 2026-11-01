/** Client-only: the last products a shopper opened on one store, kept in localStorage. */
const MAX_RECENT = 12;

export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): RecentStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    /* storage blocked */
  }
  return null;
}

const keyFor = (subdomain: string) => `kh_rv_${subdomain}`;

function load(storage: RecentStorage, subdomain: string): string[] {
  try {
    const parsed = JSON.parse(storage.getItem(keyFor(subdomain)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecentlyViewed(
  subdomain: string,
  id: string,
  storage: RecentStorage | null = defaultStorage(),
): void {
  if (!storage || !id) return;
  try {
    const next = [id, ...load(storage, subdomain).filter((v) => v !== id)].slice(0, MAX_RECENT);
    storage.setItem(keyFor(subdomain), JSON.stringify(next));
  } catch {
    /* storage full or blocked */
  }
}

/** Newest first; pass `excludeId` to leave out the product being viewed. */
export function readRecentlyViewed(
  subdomain: string,
  excludeId?: string,
  storage: RecentStorage | null = defaultStorage(),
): string[] {
  if (!storage) return [];
  try {
    return load(storage, subdomain)
      .filter((v) => v !== excludeId)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}
