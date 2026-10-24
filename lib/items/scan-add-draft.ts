import type { ScanAddForm } from '@/lib/items/scan-add-form';
import type { ScanAddSessionEntry } from '@/lib/items/scan-add-session';

/**
 * Scan & Add Items draft kept on this device, so an unfinished session survives closing the tab or
 * the app. One draft per business and user: switching business never shows or resumes another
 * business's draft. It holds only what the shopkeeper typed and the retry keys: no photos, no
 * session tokens, no provider responses.
 *
 * Rows with an itemId are confirmed by the server. Rows marked `failed` and the `current` product
 * exist only here until they are saved. Retrying either sends the original retry key, so a save
 * that already went through comes back as the same item instead of a second one.
 */

export const DRAFT_VERSION = 1;
/** A draft untouched for this long is dropped rather than offered again. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PREFIX = 'khatario.scan-add.draft';

export interface ScanAddCurrentDraft {
  barcode: string;
  form: ScanAddForm;
  idempotencyKey: string;
  lookupSource: string | null;
  usedPhoto: boolean;
}

export interface ScanAddDraft {
  version: number;
  businessId: string;
  userId: string;
  savedAt: number;
  entries: ScanAddSessionEntry[];
  /** The product being filled in when the draft was saved. Not on the server yet. */
  current: ScanAddCurrentDraft | null;
}

export type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function draftKey(businessId: string, userId: string): string {
  return `${PREFIX}:${businessId}:${userId}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function validEntry(e: unknown): e is ScanAddSessionEntry {
  if (!isObj(e)) return false;
  return (
    typeof e.key === 'string' &&
    typeof e.name === 'string' &&
    typeof e.outcome === 'string' &&
    ['created', 'existing', 'stock', 'size', 'failed'].includes(e.outcome) &&
    (e.itemId === null || typeof e.itemId === 'string')
  );
}

/**
 * The draft for this business and user, or null. A draft written for another business or user,
 * an old format, a corrupt value or one older than DRAFT_MAX_AGE_MS is not returned.
 */
export function loadDraft(store: DraftStore, businessId: string, userId: string, now = Date.now()): ScanAddDraft | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(draftKey(businessId, userId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearDraft(store, businessId, userId);
    return null;
  }
  if (
    !isObj(parsed) ||
    parsed.version !== DRAFT_VERSION ||
    parsed.businessId !== businessId ||
    parsed.userId !== userId ||
    typeof parsed.savedAt !== 'number' ||
    now - parsed.savedAt > DRAFT_MAX_AGE_MS ||
    !Array.isArray(parsed.entries)
  ) {
    clearDraft(store, businessId, userId);
    return null;
  }
  const current = isObj(parsed.current) && isObj(parsed.current.form) && typeof parsed.current.idempotencyKey === 'string'
    ? (parsed.current as unknown as ScanAddCurrentDraft)
    : null;
  return {
    version: DRAFT_VERSION,
    businessId,
    userId,
    savedAt: parsed.savedAt,
    entries: parsed.entries.filter(validEntry),
    current,
  };
}

/** Saves, or removes the draft when there is nothing left to keep. False when storage is blocked or full. */
export function saveDraft(
  store: DraftStore,
  draft: Omit<ScanAddDraft, 'version' | 'savedAt'>,
  now = Date.now()
): boolean {
  if (draft.entries.length === 0 && !draft.current) {
    clearDraft(store, draft.businessId, draft.userId);
    return true;
  }
  try {
    store.setItem(draftKey(draft.businessId, draft.userId), JSON.stringify({ ...draft, version: DRAFT_VERSION, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(store: DraftStore, businessId: string, userId: string): void {
  try {
    store.removeItem(draftKey(businessId, userId));
  } catch {
    // Storage blocked: nothing was kept anyway.
  }
}

/** A current product worth offering back: something was scanned or typed. */
export function hasUnfinishedProduct(c: ScanAddCurrentDraft | null): boolean {
  if (!c) return false;
  const f = c.form;
  return !!(c.barcode || f.name.trim() || f.opening_stock.trim() || f.purchase_price.trim() || f.mrp.trim());
}
