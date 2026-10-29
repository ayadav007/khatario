import { mapStoreItemRow } from '@/lib/store/map-store-product';

const base = { id: 'i1', name: 'Apple', selling_price: '12.50', mrp: null, unit: null, current_stock: '3' };

describe('mapStoreItemRow', () => {
  it('passes brand through and defaults a missing brand to null', () => {
    expect(mapStoreItemRow({ ...base, brand: 'Orchard' }).brand).toBe('Orchard');
    expect(mapStoreItemRow(base).brand).toBeNull();
  });

  it('parses numeric strings and keeps a missing mrp null', () => {
    const item = mapStoreItemRow(base);
    expect(item.selling_price).toBe(12.5);
    expect(item.mrp).toBeNull();
    expect(item.current_stock).toBe(3);
    expect(item.unit).toBe('PCS');
    expect(mapStoreItemRow({ ...base, mrp: '20.00' }).mrp).toBe(20);
  });

  it('turns a falsy featured flag into false and a non-array variants into []', () => {
    const item = mapStoreItemRow({ ...base, featured_in_store: null, variants: null });
    expect(item.featured_in_store).toBe(false);
    expect(item.variants).toEqual([]);
    expect(mapStoreItemRow({ ...base, featured_in_store: true, variants: [{ id: 'v' }] }).variants).toHaveLength(1);
  });
});
