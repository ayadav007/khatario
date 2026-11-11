import { packLabelFromName, unitPrice } from '@/lib/store/unit-price';

describe('unitPrice', () => {
  it.each([
    ['500 g', 30, '₹60/kg'],
    ['1kg', 110, '₹110/kg'],
    ['1.5 KG', 165, '₹110/kg'],
    ['200ml', 18, '₹90/L'],
    ['1 L', 58, '₹58/L'],
    ['1 litre', 58, '₹58/L'],
    ['4 × 100 g', 90, '₹225/kg'],
    ['500g x 2', 100, '₹100/kg'],
    ['100 g', 8, '₹80/kg'],
    ['2 kg', 15, '₹7.5/kg'],
  ])('reads weights and volumes: %s at %d', (label, price, expected) => {
    expect(unitPrice(label, price)).toBe(expected);
  });

  it('gives nothing when it cannot be sure', () => {
    for (const label of ['Pack of 2', '5-in-1 masala', 'Room no 12', '6 pcs', '2 × 6 pcs', '1 dozen', '', null, undefined]) {
      expect(unitPrice(label, 100)).toBeNull();
    }
  });

  it('gives nothing for a price that is not a positive number', () => {
    for (const price of [0, -5, NaN, Infinity]) expect(unitPrice('1 kg', price)).toBeNull();
  });

  it('rounds to whole rupees from 10 up and one decimal below, without a trailing .0', () => {
    expect(unitPrice('300 g', 35)).toBe('₹117/kg');
    expect(unitPrice('1 kg', 9.96)).toBe('₹10/kg');
    expect(unitPrice('1 kg', 8)).toBe('₹8/kg');
    expect(unitPrice('1 kg', 2500)).toBe('₹2,500/kg');
  });

  it('gives nothing when the rate rounds to zero', () => {
    expect(unitPrice('1000 kg', 1)).toBeNull();
  });
});

describe('packLabelFromName', () => {
  it('takes the pack from a product name', () => {
    expect(packLabelFromName('Tomatoes, 1 kg')).toBe('1 kg');
    expect(packLabelFromName('Masala jar set')).toBeNull();
  });

  it('keeps a multiplier that counts the pack', () => {
    expect(packLabelFromName('Biscuits 4 × 100 g')).toBe('4 × 100 g');
    expect(packLabelFromName('Rice 500g x 2')).toBe('500g x 2');
    expect(packLabelFromName('Water 1 L x 12 bottles')).toBe('1 L x 12');
    expect(packLabelFromName('Masala 2 in 1, 100 g')).toBe('100 g');
    expect(packLabelFromName('Detergent 2 in 1 1 kg')).toBe('1 kg');
  });

  it('gives nothing when the name has no weight or volume, or the pack count is unclear', () => {
    for (const name of ['5-in-1 masala', 'Room no 12', 'Soap pack of 3', 'Oil 1 L combo', 'Lemon 1 lemon']) {
      expect(packLabelFromName(name)).toBeNull();
    }
  });

  it.each([
    'Water 200 ml 6 pack',
    'Milk 1 L (2 pack)',
    '500 g (2 packs)',
    'Pack of two 500 g',
    'Oil 1L + 200 ml free',
    'Oil 1L Buy 1 Get 1',
    'Dry fruits 1 kg & 500 g',
    'Dal 1 kg - 2 kg',
    'Atta 5 kg x 12 months',
    'Atta 5kg (pack of 1 kg)',
    'Soap 100 g 3 pcs',
  ])('gives nothing when the weight is not the whole pack: %s', (name) => {
    expect(packLabelFromName(name)).toBeNull();
  });
});
