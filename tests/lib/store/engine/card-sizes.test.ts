import { cardSizes } from '@/lib/store/engine/card-sizes';
import type { StoreVariantInput } from '@/lib/store/variant-options';

let n = 0;
const v = (attributes: Record<string, string> | null, stock: number | string | null = 5, name = ''): StoreVariantInput => ({
  id: `v${++n}`,
  variant_name: name,
  selling_price: 100,
  current_stock: stock,
  attributes,
});
const sizes = (r: ReturnType<typeof cardSizes>) => r.sizes.map((s) => s.value);

describe('cardSizes', () => {
  it('lists sizes in variant order, once each', () => {
    const r = cardSizes([v({ size: 'S' }), v({ size: 'M' }), v({ size: 'm' }), v({ size: 'L' })]);
    expect(sizes(r)).toEqual(['S', 'M', 'L']);
    expect(r.more).toBe(0);
  });

  it('reads the size axis whatever the key is spelled', () => {
    expect(sizes(cardSizes([v({ Size: 'S' }), v({ SIZE: 'M' }), v({ ' size ': 'L' })]))).toEqual(['S', 'M', 'L']);
  });

  it('counts sizes typed with different case as one chip, in stock if any spelling has stock', () => {
    const r = cardSizes([v({ size: 'l' }, 0), v({ size: 'L' }, 4), v({ size: 'XL' }, 0), v({ size: 'xl' }, 0)]);
    expect(r.sizes).toEqual([
      { value: 'l', soldOut: false },
      { value: 'XL', soldOut: true },
    ]);
  });

  it('marks a size sold out only when every variant of it is at zero', () => {
    const r = cardSizes([
      v({ size: 'M', colour: 'Red' }, 0),
      v({ size: 'M', colour: 'Blue' }, 3),
      v({ size: 'XL', colour: 'Red' }, 0),
      v({ size: 'XL', colour: 'Blue' }, '0'),
    ]);
    expect(r.sizes).toEqual([
      { value: 'M', soldOut: false },
      { value: 'XL', soldOut: true },
    ]);
  });

  it('reads stock that arrives as a numeric string or null', () => {
    const r = cardSizes([v({ size: 'S' }, '2'), v({ size: 'M' }, null)]);
    expect(r.sizes).toEqual([
      { value: 'S', soldOut: false },
      { value: 'M', soldOut: true },
    ]);
  });

  it('cuts after six and counts the rest', () => {
    const r = cardSizes(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'].map((size) => v({ size })));
    expect(r.sizes.length).toBe(6);
    expect(sizes(r)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(r.more).toBe(2);
  });

  it('honours a different cut', () => {
    const r = cardSizes(['S', 'M', 'L'].map((size) => v({ size })), 2);
    expect(sizes(r)).toEqual(['S', 'M']);
    expect(r.more).toBe(1);
  });

  it('returns nothing for colour-only variants or none', () => {
    const none = { sizes: [], more: 0 };
    expect(cardSizes([v({ colour: 'Red' }), v({ colour: 'Blue' })])).toEqual(none);
    expect(cardSizes([v({ color: 'Red' })])).toEqual(none);
    expect(cardSizes([])).toEqual(none);
  });

  it('returns nothing for variants that only have a name (the single Option axis)', () => {
    expect(cardSizes([v(null, 5, 'Small'), v(null, 5, 'Large')])).toEqual({ sizes: [], more: 0 });
  });
});
