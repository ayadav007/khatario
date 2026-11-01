import { interleavePromos } from '@/components/store/engine/catalog/promo-slots';

describe('interleavePromos', () => {
  it('places a promo after item N', () => {
    expect(interleavePromos(['a', 'b', 'c'], [{ position: 2 }])).toEqual([
      { kind: 'item', item: 'a' },
      { kind: 'item', item: 'b' },
      { kind: 'promo', index: 0 },
      { kind: 'item', item: 'c' },
    ]);
  });

  it('puts promos past the end at the end once every item is loaded, in position order', () => {
    expect(interleavePromos(['a', 'b'], [{ position: 9 }, { position: 6 }, { position: 1 }], true)).toEqual([
      { kind: 'item', item: 'a' },
      { kind: 'promo', index: 2 },
      { kind: 'item', item: 'b' },
      { kind: 'promo', index: 1 },
      { kind: 'promo', index: 0 },
    ]);
    expect(interleavePromos([], [{ position: 1 }], true)).toEqual([]);
  });

  it('holds a promo past the loaded items while more can load', () => {
    expect(interleavePromos(['a', 'b', 'c'], [{ position: 9 }])).toEqual([
      { kind: 'item', item: 'a' },
      { kind: 'item', item: 'b' },
      { kind: 'item', item: 'c' },
    ]);
  });

  it('keeps block order for two promos at one position', () => {
    expect(interleavePromos(['a'], [{ position: 1 }, { position: 1 }])).toEqual([
      { kind: 'item', item: 'a' },
      { kind: 'promo', index: 0 },
      { kind: 'promo', index: 1 },
    ]);
  });
});
