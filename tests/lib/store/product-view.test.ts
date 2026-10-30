import { findVariant, productOffer, toVariantInputs } from '@/components/store/features/product/product-view';

describe('toVariantInputs', () => {
  it('keeps order and string attributes, drops junk', () => {
    const out = toVariantInputs([
      { id: 'a', variant_name: 'Red / M', selling_price: 499, current_stock: 3, attributes: { Colour: 'Red', Size: 'M', x: ['no'], y: '' } },
      { id: 'b', variant_name: 'Blue / M', selling_price: '549.00', current_stock: '0', attributes: null },
      { id: 'c', variant_name: null, selling_price: null, current_stock: undefined, attributes: 'oops' },
    ]);
    expect(out.map((v) => v.id)).toEqual(['a', 'b', 'c']);
    expect(out[0].attributes).toEqual({ Colour: 'Red', Size: 'M' });
    expect(out[1]).toMatchObject({ selling_price: '549.00', current_stock: '0', attributes: null });
    expect(out[2]).toMatchObject({ variant_name: '', selling_price: null, current_stock: null, attributes: null });
  });

  it('turns numeric attribute values into strings and skips rows without an id', () => {
    const out = toVariantInputs([
      { id: '', variant_name: 'x', selling_price: 1, current_stock: 1, attributes: {} },
      { id: 'd', variant_name: '1 kg', selling_price: 90, current_stock: 1, attributes: { weight: 1 } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].attributes).toEqual({ weight: '1' });
  });

  it('returns [] for missing lists', () => {
    expect(toVariantInputs(undefined)).toEqual([]);
    expect(toVariantInputs(null)).toEqual([]);
  });
});

describe('findVariant', () => {
  const list = toVariantInputs([
    { id: 'a', variant_name: 'A', selling_price: '120.50', current_stock: '4', attributes: null },
    { id: 'b', variant_name: 'B', selling_price: null, current_stock: null, attributes: null },
  ]);

  it('normalises price and stock to numbers', () => {
    expect(findVariant(list, 'a')).toMatchObject({ id: 'a', selling_price: 120.5, current_stock: 4 });
    expect(findVariant(list, 'b')).toMatchObject({ selling_price: null, current_stock: 0 });
  });

  it('is null for unknown or empty ids', () => {
    expect(findVariant(list, 'z')).toBeNull();
    expect(findVariant(list, null)).toBeNull();
  });
});

describe('productOffer', () => {
  const item = { selling_price: 400, mrp: 500, current_stock: 2, has_variants: false };

  it('uses the item price and shows % off when MRP is higher', () => {
    expect(productOffer(item, null, 0)).toEqual({ price: 400, mrp: 500, percentOff: 20, stock: 2, canAdd: true });
  });

  it('hides MRP when it is not above the price', () => {
    expect(productOffer({ ...item, mrp: 400 }, null, 0)).toMatchObject({ mrp: null, percentOff: 0 });
    expect(productOffer({ ...item, mrp: null }, null, 0)).toMatchObject({ mrp: null, percentOff: 0 });
  });

  it('is not addable when the item is sold out', () => {
    expect(productOffer({ ...item, current_stock: 0 }, null, 0).canAdd).toBe(false);
  });

  it('uses the chosen variant price and stock', () => {
    const v = { id: 'a', variant_name: 'A', selling_price: 450, current_stock: 1 };
    expect(productOffer({ ...item, has_variants: true }, v, 2)).toMatchObject({ price: 450, mrp: 500, percentOff: 10, stock: 1, canAdd: true });
  });

  it('falls back to the item price when the variant has none', () => {
    const v = { id: 'a', variant_name: 'A', selling_price: null, current_stock: 1 };
    expect(productOffer({ ...item, has_variants: true }, v, 1).price).toBe(400);
  });

  it('blocks add when a variant product has no variant chosen or it is sold out', () => {
    expect(productOffer({ ...item, has_variants: true }, null, 2).canAdd).toBe(false);
    const sold = { id: 'a', variant_name: 'A', selling_price: 450, current_stock: 0 };
    expect(productOffer({ ...item, has_variants: true }, sold, 2).canAdd).toBe(false);
  });
});
