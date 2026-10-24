import { BLOCKING_GAPS, type ReviewItem } from '@/lib/items/scan-add-review';

/**
 * One row of a Scan & Add session, kept in the browser until the shopkeeper finishes the session.
 * created = new item, stock = stock added, size = new pack size, existing = scanned and skipped,
 * failed = a new item whose save did not go through (kept with its body and retry key).
 */
export interface ScanAddSessionEntry {
  key: string;
  barcode: string;
  name: string;
  itemId: string | null;
  outcome: 'created' | 'existing' | 'stock' | 'size' | 'failed';
  qty: number;
  /** For created items: where the details came from. */
  source?: 'database' | 'photo' | 'manual';
  /** For failed saves: what to send again, with the same retry key, and why it failed. */
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  error?: string;
}

export interface ScanAddSessionSummary {
  scanned: number;
  created: number;
  existing: number;
  stockAdded: number;
  sizesAdded: number;
  fromDatabase: number;
  fromPhoto: number;
  typedByHand: number;
  withStock: number;
  /** Items still missing HSN, a selling price or a purchase price. */
  needDetails: number;
  /** Saves refused because the barcode is already on another item. */
  barcodeConflicts: number;
  failed: number;
}

const isBarcodeConflict = (e: ScanAddSessionEntry) => e.outcome === 'failed' && /barcode .* already exists/i.test(e.error ?? '');

export function summarizeSession(entries: ScanAddSessionEntry[], reviewed: ReviewItem[] = []): ScanAddSessionSummary {
  const by = (o: ScanAddSessionEntry['outcome']) => entries.filter((e) => e.outcome === o);
  const created = by('created');
  return {
    scanned: entries.length,
    created: created.length,
    existing: by('existing').length,
    stockAdded: by('stock').length,
    sizesAdded: by('size').length,
    fromDatabase: created.filter((e) => e.source === 'database').length,
    fromPhoto: created.filter((e) => e.source === 'photo').length,
    typedByHand: created.filter((e) => e.source === 'manual' || !e.source).length,
    withStock: entries.filter((e) => e.outcome !== 'existing' && e.outcome !== 'failed' && e.qty > 0).length,
    needDetails: reviewed.filter((i) => i.gaps.some((g) => BLOCKING_GAPS.includes(g))).length,
    barcodeConflicts: entries.filter(isBarcodeConflict).length,
    failed: by('failed').length,
  };
}

/** Item ids worth reviewing: everything saved, each once. */
export function reviewItemIds(entries: ScanAddSessionEntry[]): string[] {
  return [...new Set(entries.filter((e) => e.itemId && e.outcome !== 'failed').map((e) => e.itemId as string))];
}

/**
 * Adds a row. A skip replaces an earlier skip of the same item; a failed save is replaced by its
 * own retry (same retry key), whether that retry failed again or went through.
 */
export function addSessionEntry(entries: ScanAddSessionEntry[], entry: ScanAddSessionEntry): ScanAddSessionEntry[] {
  const rest = entries.filter((e) => {
    if (entry.outcome === 'existing' && e.outcome === 'existing' && e.itemId === entry.itemId) return false;
    if (entry.idempotencyKey && e.outcome === 'failed' && e.idempotencyKey === entry.idempotencyKey) return false;
    return e.key !== entry.key;
  });
  return [entry, ...rest];
}
