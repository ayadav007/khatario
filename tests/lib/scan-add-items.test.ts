import { emptyScanAddForm, scanAddItemPayload, validateScanAddForm } from '@/lib/items/scan-add-form';
import {
  itemCreateFingerprint,
  resolveItemCreateRecord,
  scopedItemCreateKey,
} from '@/lib/items/item-create-idempotency';
import { featureIdForPath } from '@/lib/subscription/plan-path-gate';
import type { OfflineReplayLogRow } from '@/lib/offline-sync/types';

const B = '00000000-0000-0000-0000-00000000000b';
const ITEM = '00000000-0000-0000-0000-0000000000a1';

describe('scan & add form', () => {
  const filled = { ...emptyScanAddForm('0012345678905'), name: 'Parle-G 100 g' };

  test('a name is the only thing a product without stock needs', () => {
    expect(validateScanAddForm(filled)).toEqual({});
    expect(validateScanAddForm({ ...filled, name: '  ' }).name).toBeDefined();
  });

  test('stock without a purchase price is refused', () => {
    expect(validateScanAddForm({ ...filled, opening_stock: '20' }).purchase_price).toBeDefined();
    expect(validateScanAddForm({ ...filled, opening_stock: '20', purchase_price: '0' }).purchase_price).toBeDefined();
    expect(validateScanAddForm({ ...filled, opening_stock: '20', purchase_price: '8.5' })).toEqual({});
  });

  test('selling above MRP, negative numbers and bad HSN are caught', () => {
    expect(validateScanAddForm({ ...filled, mrp: '10', selling_price: '12' }).selling_price).toBeDefined();
    expect(validateScanAddForm({ ...filled, mrp: '10', selling_price: '10' })).toEqual({});
    expect(validateScanAddForm({ ...filled, opening_stock: '-1' }).opening_stock).toBeDefined();
    expect(validateScanAddForm({ ...filled, hsn_sac: '19' }).hsn_sac).toBeDefined();
    expect(validateScanAddForm({ ...filled, hsn_sac: '1905' })).toEqual({});
  });

  test('payload keeps the barcode as text with its leading zeroes and carries no identity fields', () => {
    const body = scanAddItemPayload({ ...filled, barcode: ' 0012 3456 78905 ', size: '100 g', mrp: '10', opening_stock: '20', purchase_price: '8' });
    expect(body.barcode).toBe('0012345678905');
    expect(body.net_quantity).toBe('100 g');
    expect(body.opening_stock).toBe(20);
    expect(body.mrp).toBe(10);
    expect(body).not.toHaveProperty('business_id');
    expect(body).not.toHaveProperty('user_id');
    expect(body).not.toHaveProperty('created_by');
  });

  test('a product without a barcode sends none', () => {
    expect(scanAddItemPayload({ ...filled, barcode: '' }).barcode).toBeUndefined();
  });

  test('MRP and selling price stay separate values', () => {
    const body = scanAddItemPayload({ ...filled, mrp: '10' });
    expect(body.mrp).toBe(10);
    expect(body.selling_price).toBe(0);
  });
});

describe('item create retry key', () => {
  const body = { name: 'Parle-G', barcode: '0012345678905', opening_stock: 20, purchase_price: 8 };
  const { hash } = itemCreateFingerprint(body);
  const scopedKey = scopedItemCreateKey('k1');
  const row = (over: Partial<OfflineReplayLogRow> = {}): OfflineReplayLogRow =>
    ({
      business_id: B,
      idempotency_key: scopedKey,
      action_type: 'items.create',
      request_hash: hash,
      status: 'completed',
      entity_type: 'item',
      entity_id: ITEM,
      ...over,
    }) as OfflineReplayLogRow;
  const q = (rows: unknown[]) => ({ query: jest.fn().mockResolvedValue({ rows }) }) as any;
  const ctx = { businessId: B, scopedKey, hash };

  test('the same request hashes the same; a different quantity does not', () => {
    expect(itemCreateFingerprint({ ...body }).hash).toBe(hash);
    expect(itemCreateFingerprint({ ...body, opening_stock: 21 }).hash).not.toBe(hash);
    expect(itemCreateFingerprint({ ...body, barcode: '012345678905' }).hash).not.toBe(hash);
  });

  test('a completed key replays the item it created, scoped to the business', async () => {
    const db = q([{ id: ITEM, name: 'Parle-G' }]);
    await expect(resolveItemCreateRecord(db, row(), ctx)).resolves.toEqual({ kind: 'replay', item: { id: ITEM, name: 'Parle-G' } });
    expect(db.query.mock.calls[0][1]).toEqual([ITEM, B]);
  });

  test('a key reused for different details is a conflict', async () => {
    await expect(resolveItemCreateRecord(q([]), row({ request_hash: 'other' }), ctx)).resolves.toEqual({ kind: 'conflict' });
  });

  test("another business's record is never replayed", async () => {
    const db = q([{ id: ITEM }]);
    await expect(resolveItemCreateRecord(db, row({ business_id: 'someone-else' }), ctx)).resolves.toEqual({ kind: 'unavailable' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('an unfinished record asks for a retry, and a deleted item is unavailable', async () => {
    await expect(resolveItemCreateRecord(q([]), row({ status: 'pending' }), ctx)).resolves.toEqual({ kind: 'in_progress' });
    await expect(resolveItemCreateRecord(q([]), row(), ctx)).resolves.toEqual({ kind: 'unavailable' });
  });
});

describe('scan & add plan feature', () => {
  test('the page and its API belong to items_scan_onboarding, not advanced_barcode', () => {
    expect(featureIdForPath('/items/scan-add')).toBe('items_scan_onboarding');
    expect(featureIdForPath('/api/items/scan-add/barcode')).toBe('items_scan_onboarding');
  });

  test('the rest of items stays ungated', () => {
    expect(featureIdForPath('/items')).toBeNull();
    expect(featureIdForPath('/items/new')).toBeNull();
    expect(featureIdForPath('/api/items')).toBeNull();
  });
});
