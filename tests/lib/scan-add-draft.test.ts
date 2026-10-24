import {
  DRAFT_MAX_AGE_MS,
  draftKey,
  hasUnfinishedProduct,
  loadDraft,
  saveDraft,
  type DraftStore,
} from '@/lib/items/scan-add-draft';
import { emptyScanAddForm } from '@/lib/items/scan-add-form';
import type { ScanAddSessionEntry } from '@/lib/items/scan-add-session';

function memoryStore(): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const A = 'business-a';
const B = 'business-b';
const U = 'user-1';
const failed: ScanAddSessionEntry = {
  key: 'r1',
  barcode: '8901058000009',
  name: 'Maggi 70 g',
  itemId: null,
  outcome: 'failed',
  qty: 12,
  payload: { form: { ...emptyScanAddForm('8901058000009'), name: 'Maggi 70 g' }, lookupSource: null },
  idempotencyKey: 'k-original',
  error: 'Network error',
};
const saved: ScanAddSessionEntry = { key: 'r2', barcode: '1', name: 'Salt', itemId: 'item-1', outcome: 'created', qty: 3, idempotencyKey: 'k-salt' };
const current = {
  barcode: '8901396151005',
  form: { ...emptyScanAddForm('8901396151005'), name: 'Harpic 500 ml', opening_stock: '6', purchase_price: '80' },
  idempotencyKey: 'k-current',
  lookupSource: 'productguru',
  usedPhoto: false,
};

describe('Scan & Add draft on this device', () => {
  test('saved and restored for the same business and user, keeping retry keys and failed status', () => {
    const store = memoryStore();
    saveDraft(store, { businessId: A, userId: U, entries: [failed, saved], current }, 1000);
    const draft = loadDraft(store, A, U, 2000)!;
    expect(draft.entries).toEqual([failed, saved]);
    expect(draft.entries[0]).toEqual(expect.objectContaining({ outcome: 'failed', itemId: null, idempotencyKey: 'k-original' }));
    expect(draft.entries[1]).toEqual(expect.objectContaining({ outcome: 'created', itemId: 'item-1' }));
    expect(draft.current).toEqual(current);
  });

  test("another business, or another user, never gets this draft", () => {
    const store = memoryStore();
    saveDraft(store, { businessId: A, userId: U, entries: [failed], current }, 1000);
    expect(loadDraft(store, B, U, 2000)).toBeNull();
    expect(loadDraft(store, A, 'user-2', 2000)).toBeNull();
    // A value copied under another business's key is refused because it names business A inside.
    store.setItem(draftKey(B, U), store.getItem(draftKey(A, U))!);
    expect(loadDraft(store, B, U, 2000)).toBeNull();
    expect(store.getItem(draftKey(B, U))).toBeNull();
    expect(loadDraft(store, A, U, 2000)).not.toBeNull();
  });

  test('corrupt, old-format and expired drafts are dropped', () => {
    const store = memoryStore();
    store.setItem(draftKey(A, U), '{not json');
    expect(loadDraft(store, A, U)).toBeNull();
    store.setItem(draftKey(A, U), JSON.stringify({ version: 0, businessId: A, userId: U, savedAt: 1, entries: [] }));
    expect(loadDraft(store, A, U)).toBeNull();
    saveDraft(store, { businessId: A, userId: U, entries: [failed], current: null }, 1000);
    expect(loadDraft(store, A, U, 1000 + DRAFT_MAX_AGE_MS + 1)).toBeNull();
  });

  test('rows that are not session rows are left out', () => {
    const store = memoryStore();
    store.setItem(
      draftKey(A, U),
      JSON.stringify({ version: 1, businessId: A, userId: U, savedAt: 1000, entries: [failed, { key: 'x', outcome: 'hacked' }, 'junk'], current: null })
    );
    expect(loadDraft(store, A, U, 2000)!.entries).toEqual([failed]);
  });

  test('nothing left to keep removes the draft', () => {
    const store = memoryStore();
    saveDraft(store, { businessId: A, userId: U, entries: [failed], current: null }, 1000);
    saveDraft(store, { businessId: A, userId: U, entries: [], current: null }, 2000);
    expect(store.data.size).toBe(0);
  });

  test('blocked storage does not break the screen', () => {
    const blocked: DraftStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadDraft(blocked, A, U)).toBeNull();
    expect(saveDraft(blocked, { businessId: A, userId: U, entries: [failed], current: null })).toBe(false);
  });

  test('the draft holds what was typed and the retry keys, nothing else', () => {
    const store = memoryStore();
    saveDraft(store, { businessId: A, userId: U, entries: [failed], current }, 1000);
    const raw = store.getItem(draftKey(A, U))!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['businessId', 'current', 'entries', 'savedAt', 'userId', 'version']);
    expect(raw).not.toMatch(/token|cookie|password|data:image/i);
  });

  test('an empty product in progress is not worth offering back', () => {
    expect(hasUnfinishedProduct(null)).toBe(false);
    expect(hasUnfinishedProduct({ ...current, barcode: '', form: emptyScanAddForm('') })).toBe(false);
    expect(hasUnfinishedProduct(current)).toBe(true);
  });
});
