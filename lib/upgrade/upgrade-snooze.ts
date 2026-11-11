/** "Maybe later": the same popup stays away until the end of the local day. */

const PREFIX = 'kh-upgrade-snooze:';

function localDay(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function isUpgradeSnoozed(key: string, now: Date, store: Pick<Storage, 'getItem'>): boolean {
  try {
    return store.getItem(PREFIX + key) === localDay(now);
  } catch {
    return false;
  }
}

export function snoozeUpgrade(key: string, now: Date, store: Pick<Storage, 'setItem'>): void {
  try {
    store.setItem(PREFIX + key, localDay(now));
  } catch {
    // Private mode or blocked storage: the popup may show again, which is harmless.
  }
}
