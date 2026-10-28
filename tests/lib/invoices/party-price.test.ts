import { calculateRow } from '@/lib/invoice-engine';
import { partyPricePatch, storedPriceToBillUnit } from '@/lib/invoices/party-price';

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

describe('storedPriceToBillUnit', () => {
  it('converts between GST bases and leaves matching bases alone', () => {
    expect(storedPriceToBillUnit(118, true, 18, false)).toBeCloseTo(100);
    expect(storedPriceToBillUnit(100, false, 18, true)).toBeCloseTo(118);
    expect(storedPriceToBillUnit(118, true, 18, true)).toBe(118);
    expect(storedPriceToBillUnit(100, false, 18, false)).toBe(100);
    expect(storedPriceToBillUnit(118, true, 0, false)).toBe(118);
  });
});

describe('partyPricePatch', () => {
  it('bills a GST-inclusive party price of 118 at 118 when the bill is in "prices include GST" mode', () => {
    const row = { ...baseRow, price: 118, taxPercent: 18, gstIncluded: true, catalogPrice: 130 };
    const patch = partyPricePatch({ ...row, price: 130 }, 118, true);
    expect(patch).toEqual({ price: 118, partyPriceApplied: true });

    const billed = calculateRow({ ...row, ...patch! } as any, ctx(true));
    expect(billed.total).toBeCloseTo(118, 2);
  });

  it('still bills the pre-GST equivalent when the bill is in exclusive mode', () => {
    const row = { ...baseRow, price: 110.17, taxPercent: 18, gstIncluded: true, catalogPrice: 130 };
    const patch = partyPricePatch(row, 118, false);
    expect(patch!.price).toBeCloseTo(100);
    const billed = calculateRow({ ...row, ...patch! } as any, ctx(false));
    expect(billed.total).toBeCloseTo(118, 2);
  });

  it('puts the catalog price back when the new customer has no party price', () => {
    const pricedForA = { ...baseRow, price: 90, taxPercent: 0, gstIncluded: false, catalogPrice: 100, partyPriceApplied: true };
    expect(partyPricePatch(pricedForA, null, false)).toEqual({ price: 100, partyPriceApplied: false });
  });

  it('applies the new customer\'s own party price when switching customers', () => {
    const pricedForA = { ...baseRow, price: 90, taxPercent: 0, catalogPrice: 100, partyPriceApplied: true };
    expect(partyPricePatch(pricedForA, 95, false)).toEqual({ price: 95, partyPriceApplied: true });
  });

  it('never touches a price typed by hand', () => {
    const typed = { ...baseRow, price: 77, taxPercent: 0, catalogPrice: 100, partyPriceApplied: true, priceUserOverride: true };
    expect(partyPricePatch(typed, null, false)).toBeNull();
    expect(partyPricePatch(typed, 90, false)).toBeNull();
  });

  it('leaves a catalog-priced line alone when the customer has no party price', () => {
    const catalogLine = { ...baseRow, price: 100, taxPercent: 0, catalogPrice: 100 };
    expect(partyPricePatch(catalogLine, null, false)).toBeNull();
  });

  it('leaves a loaded line without a catalog price alone when there is no party price', () => {
    const loaded = { ...baseRow, price: 90, taxPercent: 0, partyPriceApplied: true };
    expect(partyPricePatch(loaded, null, false)).toBeNull();
  });
});
