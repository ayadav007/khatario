import { calculateRow } from '@/lib/invoice-engine';
import { isBelowCost, priceNote, pricingPatch, storedPriceToBillUnit, type ResolvedLinePrice } from '@/lib/invoices/party-price';

const baseRow = {
  itemId: 'item-1',
  name: 'Item',
  quantity: 1,
  freeQty: 0,
  unit: 'PCS',
  discountPercent: 0,
  discountAmount: 0,
  taxAmount: 0,
  hsnSac: '',
  taxableValue: 0,
  cgstAmount: 0,
  sgstAmount: 0,
  igstAmount: 0,
  total: 0,
};

const ctx = (pricesIncludeGst: boolean) =>
  ({ businessStateCode: '27', businessState: 'Maharashtra', placeOfSupply: 'Maharashtra', pricesIncludeGst } as any);

const resolved = (r: Partial<ResolvedLinePrice>): ResolvedLinePrice => ({
  price: null,
  priceSource: 'catalog',
  discountPercent: null,
  levelName: null,
  costPrice: null,
  lastSale: null,
  ...r,
});

describe('storedPriceToBillUnit', () => {
  it('converts between GST bases and leaves matching bases alone', () => {
    expect(storedPriceToBillUnit(118, true, 18, false)).toBeCloseTo(100);
    expect(storedPriceToBillUnit(100, false, 18, true)).toBeCloseTo(118);
    expect(storedPriceToBillUnit(118, true, 18, true)).toBe(118);
    expect(storedPriceToBillUnit(100, false, 18, false)).toBe(100);
    expect(storedPriceToBillUnit(118, true, 0, false)).toBe(118);
  });
});

describe('pricingPatch', () => {
  it('bills a GST-inclusive customer price of 118 at 118 when the bill is in "prices include GST" mode', () => {
    const row = { ...baseRow, price: 130, taxPercent: 18, gstIncluded: true, catalogPrice: 130 };
    const patch = pricingPatch(row, resolved({ price: 118, priceSource: 'party' }), true);
    expect(patch).toMatchObject({ price: 118, partyPriceApplied: true, priceSource: 'party' });

    const billed = calculateRow({ ...row, ...patch! } as any, ctx(true));
    expect(billed.total).toBeCloseTo(118, 2);
  });

  it('still bills the pre-GST equivalent when the bill is in exclusive mode', () => {
    const row = { ...baseRow, price: 110.17, taxPercent: 18, gstIncluded: true };
    const patch = pricingPatch(row, resolved({ price: 118, priceSource: 'party' }), false);
    expect(patch!.price).toBeCloseTo(100);
    const billed = calculateRow({ ...row, ...patch! } as any, ctx(false));
    expect(billed.total).toBeCloseTo(118, 2);
  });

  it('puts the catalog price back when the new customer has no special price', () => {
    const pricedForA = { ...baseRow, price: 90, taxPercent: 0, catalogPrice: 100, partyPriceApplied: true, priceSource: 'party' as const };
    expect(pricingPatch(pricedForA, resolved({ price: 100 }), false)).toMatchObject({
      price: 100,
      partyPriceApplied: false,
      priceSource: 'catalog',
    });
  });

  it('applies a price level rate and names the level', () => {
    const row = { ...baseRow, price: 100, taxPercent: 0 };
    expect(pricingPatch(row, resolved({ price: 92, priceSource: 'level', levelName: 'Wholesale' }), false)).toMatchObject({
      price: 92,
      partyPriceApplied: true,
      levelName: 'Wholesale',
    });
  });

  it('applies a rule discount and clears it again when the rule no longer applies', () => {
    const row = { ...baseRow, price: 100, taxPercent: 0 };
    const withDisc = { ...row, ...pricingPatch(row, resolved({ price: 100, discountPercent: 5 }), false)! };
    expect(withDisc).toMatchObject({ discountPercent: 5, pricingDiscountApplied: true });
    expect(pricingPatch(withDisc, resolved({ price: 100 }), false)).toMatchObject({ discountPercent: 0, pricingDiscountApplied: false });
  });

  it('never replaces a discount typed by hand', () => {
    const row = { ...baseRow, price: 100, taxPercent: 0, discountPercent: 2, discountUserOverride: true };
    expect(pricingPatch(row, resolved({ price: 100, discountPercent: 5 }), false)).toMatchObject({ priceSource: 'catalog' });
    expect(pricingPatch(row, resolved({ price: 100, discountPercent: 5 }), false)).not.toHaveProperty('discountPercent');
  });

  it('never touches the price or discount of a line typed by hand, loaded, or agreed on an order', () => {
    const fixed = { ...baseRow, price: 77, taxPercent: 0, discountPercent: 1, priceUserOverride: true, partyPriceApplied: true };
    expect(pricingPatch(fixed, resolved({ price: 90, priceSource: 'party', discountPercent: 10 }), false)).toBeNull();
    const withInfo = pricingPatch(fixed, resolved({ price: 90, costPrice: 50 }), false);
    expect(withInfo).toEqual({ costPrice: 50 });
  });

  it('returns null when nothing changes', () => {
    const row = { ...baseRow, price: 100, taxPercent: 0, priceSource: 'catalog' as const, levelName: null, costPrice: null, lastSale: null };
    expect(pricingPatch(row, resolved({ price: 100 }), false)).toBeNull();
  });
});

describe('below cost and price note', () => {
  it('warns when the net pre-GST price is below the purchase price', () => {
    const row = { ...baseRow, price: 118, taxPercent: 18, discountPercent: 0, costPrice: 105 };
    expect(isBelowCost(row, true)).toBe(true); // 118 incl. GST = 100 pre-GST
    expect(isBelowCost(row, false)).toBe(false);
    expect(isBelowCost({ ...row, discountPercent: 10 }, false)).toBe(false); // 106.2
    expect(isBelowCost({ ...row, discountPercent: 20 }, false)).toBe(true); // 94.4
    expect(isBelowCost({ ...row, costPrice: null }, true)).toBe(false);
  });

  it('describes the price source and last rate', () => {
    const note = priceNote({
      price: 90,
      discountPercent: 0,
      taxPercent: 5,
      priceSource: 'level',
      levelName: 'Dealer',
      lastSale: { exclusivePrice: 88, discountPercent: 2, date: '2026-10-12', documentNumber: 'INV-1' },
    });
    expect(note).toContain('Dealer rate');
    expect(note).toContain('Last ₹88.00 −2% + GST');
  });
});
