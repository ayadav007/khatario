/**
 * BLUETOOTH PRINTER STORAGE
 *
 * Persists paired printers in localStorage, keyed by business id so multiple
 * tenants can co-exist on the same device.
 *
 * Why localStorage and not the server database
 * -------------------------------------------
 * A Bluetooth pairing is inherently device-scoped: the browser binds the
 * pairing to the current tab's BluetoothDevice instance, the OS tracks the
 * pairing per-user-per-machine, and a different cashier tablet will have
 * its own pairings. Storing the selection server-side would force us to
 * re-pair on every device anyway, and would also leak device ids between
 * users of the same business. LocalStorage is the honest fit.
 *
 * If we ever need a DB-backed "default printer for this cashier" we can
 * layer that on top of this with a second storage adapter without changing
 * consumers.
 */

import type { SavedBluetoothPrinter } from './types';

const STORAGE_PREFIX = 'khatario.bluetooth-printers.';

function storageKey(businessId: string): string {
  return `${STORAGE_PREFIX}${businessId}`;
}

function getStore(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function listSavedPrinters(
  businessId: string
): SavedBluetoothPrinter[] {
  const store = getStore();
  if (!store || !businessId) return [];
  const raw = store.getItem(storageKey(businessId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: any): p is SavedBluetoothPrinter =>
        p && typeof p.id === 'string' && typeof p.name === 'string'
    );
  } catch {
    return [];
  }
}

export function savePrinter(
  businessId: string,
  printer: SavedBluetoothPrinter
): SavedBluetoothPrinter[] {
  const current = listSavedPrinters(businessId);
  const next = current.filter((p) => p.id !== printer.id);
  next.push({ ...printer, lastUsedAt: Date.now() });
  const store = getStore();
  if (store && businessId) {
    store.setItem(storageKey(businessId), JSON.stringify(next));
  }
  return next;
}

export function removePrinter(
  businessId: string,
  printerId: string
): SavedBluetoothPrinter[] {
  const current = listSavedPrinters(businessId);
  const next = current.filter((p) => p.id !== printerId);
  const store = getStore();
  if (store && businessId) {
    store.setItem(storageKey(businessId), JSON.stringify(next));
  }
  return next;
}

/**
 * Convenience: exclusively mark one printer as the preferred target for the
 * given usage, clearing the flag on the others.
 */
export function setPreferredFor(
  businessId: string,
  printerId: string,
  usage: 'labels' | 'receipts'
): SavedBluetoothPrinter[] {
  const current = listSavedPrinters(businessId);
  const next = current.map((p) => ({
    ...p,
    ...(usage === 'labels'
      ? { preferForLabels: p.id === printerId }
      : { preferForReceipts: p.id === printerId }),
  }));
  const store = getStore();
  if (store && businessId) {
    store.setItem(storageKey(businessId), JSON.stringify(next));
  }
  return next;
}

/** Clear the "lastUsedAt" timestamp so the picker can re-sort by recency. */
export function touchPrinter(
  businessId: string,
  printerId: string
): SavedBluetoothPrinter | null {
  const current = listSavedPrinters(businessId);
  const found = current.find((p) => p.id === printerId);
  if (!found) return null;
  found.lastUsedAt = Date.now();
  const store = getStore();
  if (store && businessId) {
    store.setItem(storageKey(businessId), JSON.stringify(current));
  }
  return found;
}

/** Resolve the preferred printer for a given usage, or undefined. */
export function getPreferredPrinter(
  businessId: string,
  usage: 'labels' | 'receipts'
): SavedBluetoothPrinter | undefined {
  const all = listSavedPrinters(businessId);
  const preferredFlag: keyof SavedBluetoothPrinter =
    usage === 'labels' ? 'preferForLabels' : 'preferForReceipts';
  const preferred = all.find((p) => p[preferredFlag]);
  if (preferred) return preferred;
  // Otherwise the most recently used one is a reasonable default.
  return [...all].sort(
    (a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0)
  )[0];
}
