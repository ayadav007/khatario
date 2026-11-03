import { cardPacks, cartLineFor, packPriceShowsMrp } from '@/lib/store/engine/card-packs';
import type { StoreVariantInput } from '@/lib/store/variant-options';
import type { StoreCartItem } from '@/lib/store/store-context';

const v = (
  id: string,
  attributes: Record<string, string> | null,
  price: number | string | null = 100,
  stock: number | string | null = 5,
  name = '',
): StoreVariantInput => ({ id, variant_name: name, selling_price: price, current_stock: stock, attributes });
const labels = (r: ReturnType<typeof cardPacks>) => r.packs.map((p) => p.label);

describe('cardPacks', () => {
  it('lists one-axis packs in order', () => {
    const bySize = cardPacks([v('a', { size: '500 g' }, 549), v('b', { Size: '1 kg' }, 1050), v('c', { size: '5 kg' }, '4990', '0')]);
    expect(bySize).toEqual({
      packs: [
        { id: 'a', label: '500 g', price: 549, stock: 5, soldOut: false },
        { id: 'b', label: '1 kg', price: 1050, stock: 5, soldOut: false },
        { id: 'c', label: '5 kg', price: 4990, stock: 0, soldOut: true },
      ],
      more: 0,
      axisCount: 1,
    });
    expect(labels(cardPacks([v('a', { weight: '200 g' }), v('b', { Weight: '1 kg' })]))).toEqual(['200 g', '1 kg']);
    const named = cardPacks([v('x', null, 60, 3, '1 L'), v('y', null, 110, 3, '2 L')]);
    expect(named.packs.map((p) => [p.id, p.label, p.price])).toEqual([
      ['x', '1 L', 60],
      ['y', '2 L', 110],
    ]);
    expect(named.axisCount).toBe(1);
  });

  it('reports two axes so the card falls back', () => {
    const r = cardPacks([v('a', { size: 'M', colour: 'Red' }), v('b', { size: 'L', colour: 'Blue' })]);
    expect(r).toEqual({ packs: [], more: 0, axisCount: 2 });
  });

  it('gives nothing for no variants', () => {
    expect(cardPacks([])).toEqual({ packs: [], more: 0, axisCount: 0 });
  });

  it('cuts at four with more', () => {
    const r = cardPacks(['100 g', '250 g', '500 g', '1 kg', '2 kg', '5 kg'].map((size, i) => v(`v${i}`, { size })));
    expect(labels(r)).toEqual(['100 g', '250 g', '500 g', '1 kg']);
    expect(r.more).toBe(2);
    expect(r.axisCount).toBe(1);
    expect(cardPacks([v('a', { size: '1 kg' }), v('b', { size: '2 kg' })], 1)).toMatchObject({ more: 1 });
  });

  it('marks sold-out packs', () => {
    const r = cardPacks([v('a', { size: '1 kg' }, 100, 0), v('b', { size: '2 kg' }, 190, null), v('c', { size: '5 kg' }, 450, '2')]);
    expect(r.packs.map((p) => [p.label, p.soldOut, p.stock])).toEqual([
      ['1 kg', true, 0],
      ['2 kg', true, 0],
      ['5 kg', false, 2],
    ]);
  });

  it("shows MRP only for the product's own price", () => {
    expect(packPriceShowsMrp(549, 549)).toBe(true);
    expect(packPriceShowsMrp(1050, 549)).toBe(false);
  });

  it('keeps packs of one product apart in the cart', () => {
    const line = (variantId: string | undefined, quantity: number): StoreCartItem => ({
      itemId: 'a',
      variantId,
      name: 'Atta',
      price: 100,
      quantity,
      unit: 'pcs',
      maxStock: 9,
    });
    const cart = [line('1kg', 2), line('5kg', 1), { ...line(undefined, 4), itemId: 'b' }];
    expect(cartLineFor(cart, 'a', '1kg')?.quantity).toBe(2);
    expect(cartLineFor(cart, 'a', '5kg')?.quantity).toBe(1);
    expect(cartLineFor(cart, 'a', '10kg')).toBeUndefined();
    expect(cartLineFor(cart, 'b', undefined)?.quantity).toBe(4);
    expect(cartLineFor(cart, 'a', undefined)).toBeUndefined();
  });
});
