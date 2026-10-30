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

  it('drops a promo past the end', () => {
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
