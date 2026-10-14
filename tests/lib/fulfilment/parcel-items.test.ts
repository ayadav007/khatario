import { resolveParcelContents, type OrderLineRef } from '@/lib/fulfilment/parcel-items';

const lines: OrderLineRef[] = [
  { line_id: 'a', item_id: 'i1', name: 'Shirt', quantity: 3 },
  { line_id: 'b', item_id: 'i2', name: 'Cap', quantity: 1 },
];

describe('resolveParcelContents', () => {
  test('one parcel with no list carries the whole order', () => {
    const out = resolveParcelContents(lines, [{ id: 'p1', seq: 1, status: 'confirmed' }], []);
    expect(out.get('p1')).toEqual([
      { line_id: 'a', name: 'Shirt', quantity: 3 },
      { line_id: 'b', name: 'Cap', quantity: 1 },
    ]);
  });

  test('a listed parcel carries its list; the unlisted one carries the rest', () => {
    const out = resolveParcelContents(
      lines,
      [
        { id: 'p1', seq: 1, status: 'shipped' },
        { id: 'p2', seq: 2, status: 'confirmed' },
      ],
      [{ fulfilment_id: 'p1', line_id: 'a', quantity: 2 }],
    );
    expect(out.get('p1')).toEqual([{ line_id: 'a', name: 'Shirt', quantity: 2 }]);
    expect(out.get('p2')).toEqual([
      { line_id: 'a', name: 'Shirt', quantity: 1 },
      { line_id: 'b', name: 'Cap', quantity: 1 },
    ]);
  });

  test('a cancelled parcel does not use up quantities', () => {
    const out = resolveParcelContents(
      lines,
      [
        { id: 'p1', seq: 1, status: 'cancelled' },
        { id: 'p2', seq: 2, status: 'confirmed' },
      ],
      [{ fulfilment_id: 'p1', line_id: 'a', quantity: 3 }],
    );
    expect(out.get('p2')).toEqual([
      { line_id: 'a', name: 'Shirt', quantity: 3 },
      { line_id: 'b', name: 'Cap', quantity: 1 },
    ]);
  });

  test('only the first unlisted parcel takes the rest', () => {
    const out = resolveParcelContents(
      lines,
      [
        { id: 'p1', seq: 1, status: 'packed' },
        { id: 'p2', seq: 2, status: 'confirmed' },
      ],
      [],
    );
    expect(out.get('p1')).toHaveLength(2);
    expect(out.get('p2')).toEqual([]);
  });
});
