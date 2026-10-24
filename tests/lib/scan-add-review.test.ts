import { reviewGaps, type ReviewItem } from '@/lib/items/scan-add-review';
import { addSessionEntry, reviewItemIds, summarizeSession, type ScanAddSessionEntry } from '@/lib/items/scan-add-session';

const base: Omit<ReviewItem, 'gaps'> = {
  id: 'i1',
  name: 'Parle-G 100 g',
  barcode: '8901063010338',
  net_quantity: '100 g',
  mrp: 10,
  selling_price: 10,
  purchase_price: 8,
  tax_rate: 5,
  hsn_sac: '1905',
  current_stock: 24,
  has_variants: false,
  track_batch: false,
  next_expiry: null,
  from_database: false,
  variants: [],
};

describe('what an item still lacks', () => {
  test('a complete item has no gaps', () => {
    expect(reviewGaps(base)).toEqual([]);
  });

  test('missing HSN, prices, MRP, stock and a 0% rate are each named', () => {
    expect(reviewGaps({ ...base, hsn_sac: null, selling_price: 0, purchase_price: null, mrp: null, current_stock: 0, tax_rate: 0 })).toEqual([
      'hsn',
      'selling_price',
      'purchase_price',
      'mrp',
      'stock',
      'gst_zero',
    ]);
  });

  test('sizes are checked one by one, and MRP is not asked of the parent', () => {
    const sized = {
      ...base,
      has_variants: true,
      mrp: null,
      selling_price: null,
      purchase_price: null,
      current_stock: 0,
      variants: [
        { id: 'v1', variant_name: '100 g', selling_price: 10, purchase_price: 8, current_stock: 5 },
        { id: 'v2', variant_name: '75 g', selling_price: 0, purchase_price: 6, current_stock: 0 },
      ],
    };
    expect(reviewGaps(sized)).toEqual(['selling_price']);
  });
});

describe('session summary', () => {
  const row = (over: Partial<ScanAddSessionEntry>): ScanAddSessionEntry => ({
    key: Math.random().toString(36),
    barcode: '',
    name: 'x',
    itemId: 'i1',
    outcome: 'created',
    qty: 0,
    ...over,
  });

  test('counts each kind of row, sources, stock and conflicts', () => {
    const entries = [
      row({ itemId: 'a', source: 'database', qty: 12 }),
      row({ itemId: 'b', source: 'photo' }),
      row({ itemId: 'c', source: 'manual', qty: 3 }),
      row({ itemId: 'd', outcome: 'existing' }),
      row({ itemId: 'e', outcome: 'stock', qty: 10 }),
      row({ itemId: 'e', outcome: 'size', qty: 4 }),
      row({ itemId: null, outcome: 'failed', error: 'Barcode "890" already exists for item "Salt"' }),
      row({ itemId: null, outcome: 'failed', error: 'Network error' }),
    ];
    const needs = { ...base, id: 'b', gaps: ['hsn' as const] };
    const fine = { ...base, id: 'a', gaps: ['mrp' as const] };
    expect(summarizeSession(entries, [needs, fine])).toEqual({
      scanned: 8,
      created: 3,
      existing: 1,
      stockAdded: 1,
      sizesAdded: 1,
      fromDatabase: 1,
      fromPhoto: 1,
      typedByHand: 1,
      withStock: 4,
      needDetails: 1,
      barcodeConflicts: 1,
      failed: 2,
    });
  });

  test('items are reviewed once each, and failed rows are not looked up', () => {
    expect(reviewItemIds([row({ itemId: 'a' }), row({ itemId: 'a', outcome: 'stock' }), row({ itemId: null, outcome: 'failed' })])).toEqual(['a']);
  });

  test('a retry that succeeds replaces its failed row; a second skip replaces the first', () => {
    const failed = row({ key: 'f', itemId: null, outcome: 'failed', idempotencyKey: 'k1' });
    const skip = row({ key: 's1', itemId: 'd', outcome: 'existing' });
    let entries = addSessionEntry([], failed);
    entries = addSessionEntry(entries, skip);
    entries = addSessionEntry(entries, row({ key: 's2', itemId: 'd', outcome: 'existing' }));
    entries = addSessionEntry(entries, row({ key: 'ok', itemId: 'n', outcome: 'created', idempotencyKey: 'k1' }));
    expect(entries.map((e) => e.key)).toEqual(['ok', 's2']);
  });

  test('stock added twice to one item stays two rows', () => {
    let entries = addSessionEntry([], row({ key: 'a1', itemId: 'a', outcome: 'stock', qty: 5 }));
    entries = addSessionEntry(entries, row({ key: 'a2', itemId: 'a', outcome: 'stock', qty: 5 }));
    expect(entries).toHaveLength(2);
  });
});
