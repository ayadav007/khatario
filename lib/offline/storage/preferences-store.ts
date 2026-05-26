import { Preferences } from '@capacitor/preferences';
import { isCapacitorNative } from '@/lib/capacitor/platform';

const PREFS_PREFIX = 'khatario_offline_';

/**
 * Small metadata store for native shell / cross-boot hints.
 * Large payloads live in IndexedDB on the remote WebView origin.
 */
export async function prefsGet(key: string): Promise<string | null> {
  const fullKey = `${PREFS_PREFIX}${key}`;
  if (isCapacitorNative()) {
    const { value } = await Preferences.get({ key: fullKey });
    return value;
  }
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(fullKey);
}

export async function prefsSet(key: string, value: string): Promise<void> {
  const fullKey = `${PREFS_PREFIX}${key}`;
  if (isCapacitorNative()) {
    await Preferences.set({ key: fullKey, value });
    return;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(fullKey, value);
  }
}

export async function prefsRemove(key: string): Promise<void> {
  const fullKey = `${PREFS_PREFIX}${key}`;
  if (isCapacitorNative()) {
    await Preferences.remove({ key: fullKey });
    return;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(fullKey);
  }
}

export async function saveAuthSessionHint(scope: {
  businessId: string;
  userId: string;
  lastRoute?: string;
}): Promise<void> {
  await prefsSet(
    'auth_session_hint',
    JSON.stringify({ ...scope, savedAt: Date.now() })
  );
}

export async function loadAuthSessionHint(): Promise<{
  businessId: string;
  userId: string;
  lastRoute?: string;
  savedAt: number;
} | null> {
  const raw = await prefsGet('auth_session_hint');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
