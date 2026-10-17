import { resolvePurchaseItemName } from '@/lib/purchases/purchase-line-name';
import { itcMenuPresentation } from '@/lib/gst/pending-itc';

describe('resolvePurchaseItemName', () => {
  const db = {
    query: jest.fn(async () => ({ rows: [{ name: 'Steel Almirah' }] })),
  };

  it('keeps a typed name and does not look up the catalogue', async () => {
    const name = await resolvePurchaseItemName(db, 'biz', { item_id: 'item-1', item_name: '  Typed name  ' });
    expect(name).toBe('Typed name');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('uses the catalogue product name when the line only has an item id', async () => {
    const name = await resolvePurchaseItemName(db, 'biz', { item_id: 'item-1', item_name: '  ' });
    expect(name).toBe('Steel Almirah');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT name FROM items'),
      ['item-1', 'biz']
    );
  });

  it('returns null when the line has no name and no catalogue product', async () => {
    expect(await resolvePurchaseItemName(db, 'biz', { item_name: '' })).toBeNull();
  });
});

describe('itcMenuPresentation', () => {
  it('shows the not-imported and stale labels without a count', () => {
    expect(itcMenuPresentation({ state: 'not_imported', label: 'GSTR-2B not imported' })).toEqual({
      count: null,
      note: 'GSTR-2B not imported',
    });
    expect(itcMenuPresentation({ state: 'stale', label: 'Count is out of date — reconciliation has not been rerun' })).toEqual({
      count: null,
      note: 'Count is out of date — reconciliation has not been rerun',
    });
  });

  it('shows a known count, including zero, and hides nothing as zero when the response is missing', () => {
    expect(itcMenuPresentation({ state: 'known', count: 4 })).toEqual({ count: 4, note: null });
    expect(itcMenuPresentation({ state: 'known', count: 0 })).toEqual({ count: 0, note: null });
    expect(itcMenuPresentation(null)).toEqual({ count: null, note: null });
  });
});
