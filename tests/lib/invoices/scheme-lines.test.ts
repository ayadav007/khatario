import { reconcileSchemeLines, type PricedLine } from '@/lib/invoices/use-party-pricing';

const line = (r: Partial<PricedLine>): PricedLine => ({
  itemId: 'soap',
  name: 'Soap',
  quantity: 1,
  price: 10,
  discountPercent: 0,
  taxPercent: 18,
  ...r,
});
const makeFree = (paid: PricedLine, qty: number): PricedLine => ({
  ...paid,
  name: `${paid.name} (free)`,
  quantity: qty,
  price: 0,
  priceUserOverride: true,
  scheme: null,
  schemeOf: `${paid.itemId}:${paid.variantId ?? ''}`,
});
const scheme = { buyQty: 10, freeQty: 1 };

describe('reconcileSchemeLines', () => {
  it('adds a free line right after the paid line once the quantity is reached', () => {
    const rows = [line({ quantity: 9, scheme }), line({ itemId: 'oil', name: 'Oil' })];
    expect(reconcileSchemeLines(rows, makeFree)).toBe(rows);

    const out = reconcileSchemeLines([line({ quantity: 25, scheme }), line({ itemId: 'oil', name: 'Oil' })], makeFree);
    expect(out.map((r) => [r.name, r.quantity, r.price])).toEqual([
      ['Soap', 25, 10],
      ['Soap (free)', 2, 0],
      ['Oil', 1, 10],
    ]);
  });

  it('updates the free quantity and removes the free line when it is no longer earned', () => {
    const withFree = reconcileSchemeLines([line({ quantity: 10, scheme })], makeFree);
    expect(withFree).toHaveLength(2);

    const more = reconcileSchemeLines([{ ...withFree[0], quantity: 30 }, withFree[1]], makeFree);
    expect(more[1].quantity).toBe(3);

    expect(reconcileSchemeLines([{ ...withFree[0], quantity: 4 }, withFree[1]], makeFree)).toHaveLength(1);
    expect(reconcileSchemeLines([withFree[1]], makeFree)).toEqual([]);
  });

  it('leaves lines with a fixed price (typed or loaded) alone', () => {
    const rows = [line({ quantity: 20, scheme, priceUserOverride: true })];
    expect(reconcileSchemeLines(rows, makeFree)).toBe(rows);
  });
});
