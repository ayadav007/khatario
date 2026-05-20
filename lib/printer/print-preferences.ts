/**
 * Client-side print preferences (device-scoped), BillBook-style.
 */

export type PrintOutputMode = 'regular' | 'thermal';
export type RegularPageSize = 'a4' | 'a5';

const KEY_PREFIX = 'khatario.print-prefs.';

export type PrintPreferences = {
  outputMode: PrintOutputMode;
  regularPageSize: RegularPageSize;
};

const DEFAULTS: PrintPreferences = {
  outputMode: 'thermal',
  regularPageSize: 'a5',
};

function storageKey(businessId: string): string {
  return `${KEY_PREFIX}${businessId}`;
}

function getStore(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getPrintPreferences(businessId: string): PrintPreferences {
  const store = getStore();
  if (!store || !businessId) return { ...DEFAULTS };
  const raw = store.getItem(storageKey(businessId));
  if (!raw) return { ...DEFAULTS };
  try {
    const p = JSON.parse(raw) as Partial<PrintPreferences>;
    return {
      outputMode: p.outputMode === 'regular' ? 'regular' : 'thermal',
      regularPageSize: p.regularPageSize === 'a4' ? 'a4' : 'a5',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setPrintPreferences(
  businessId: string,
  partial: Partial<PrintPreferences>
): PrintPreferences {
  const next = { ...getPrintPreferences(businessId), ...partial };
  const store = getStore();
  if (store && businessId) {
    store.setItem(storageKey(businessId), JSON.stringify(next));
  }
  return next;
}
