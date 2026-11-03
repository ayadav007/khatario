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
});

describe('packLabelFromName', () => {
  it('takes the pack from a product name', () => {
    expect(packLabelFromName('Tomatoes, 1 kg')).toBe('1 kg');
    expect(packLabelFromName('Masala jar set')).toBeNull();
  });

  it('takes the last pack and keeps a multiplier', () => {
    expect(packLabelFromName('Atta 5kg (pack of 1 kg)')).toBe('1 kg');
    expect(packLabelFromName('Biscuits 4 × 100 g')).toBe('4 × 100 g');
    expect(packLabelFromName('Rice 500g x 2')).toBe('500g x 2');
  });

  it('gives nothing when the name has no weight or volume, or the pack count is unclear', () => {
    for (const name of ['5-in-1 masala', 'Room no 12', 'Soap pack of 3', 'Oil 1 L combo', 'Lemon 1 lemon']) {
      expect(packLabelFromName(name)).toBeNull();
    }
  });
});
