import { activeQuickCategory, quickChips, quickDeliveryLine, quickSearchHints } from '@/lib/store/engine/quick-header';
import { cleanPincode, pincodeLine, pincodeServiceable } from '@/lib/store/store-pincode';

describe('Quick header', () => {
  it('reads a delivery time as "Delivery …", keeps a "Deliver…" line, else shows the store name', () => {
    expect(quickDeliveryLine('in 30 minutes', 'Shop')).toBe('Delivery in 30 minutes');
    expect(quickDeliveryLine('10 mins', 'Shop')).toBe('Delivery 10 mins');
    expect(quickDeliveryLine('Delivery by 7 pm', 'Shop')).toBe('Delivery by 7 pm');
    expect(quickDeliveryLine('Fresh Groceries delivered', 'Shop')).toBe('Shop');
    expect(quickDeliveryLine('Khatario theme preview', 'Quick preview')).toBe('Quick preview');
    expect(quickDeliveryLine('  ', 'Shop')).toBe('Shop');
  });

  it('orders pills as menu links, categories, then highlighted links', () => {
    const chips = quickChips(
      [
        { label: 'All Products', href: '/catalog', highlight: false },
        { label: 'Offers', href: '/catalog?disc=10', highlight: true },
        { label: 'Fruits', href: '/catalog/f', highlight: false },
      ],
      [
        { id: 'v', name: 'Vegetables' },
        { id: 'f', name: 'fruits' },
      ],
    );
    expect(chips.map((c) => [c.label, c.offers])).toEqual([
      ['All Products', false],
      ['Fruits', false],
      ['Vegetables', false],
      ['Offers', true],
    ]);
    expect(chips[2]).toMatchObject({ categoryId: 'v' });
    expect(chips[3]).toMatchObject({ href: '/catalog?disc=10' });
  });

  it('knows the category from the catalog path or the home ?cat', () => {
    expect(activeQuickCategory('/catalog/abc', null)).toBe('abc');
    expect(activeQuickCategory('/', 'xyz')).toBe('xyz');
    expect(activeQuickCategory('/catalog', null)).toBeNull();
    expect(activeQuickCategory('/products/p1', '')).toBeNull();
  });

  it('cycles category hints, or keeps the placeholder', () => {
    expect(quickSearchHints('Search products', [{ name: 'Milk' }, { name: 'Rice' }])).toEqual(['Search “Milk”', 'Search “Rice”']);
    expect(quickSearchHints('Search products', [])).toEqual(['Search products']);
  });
});

describe('delivery pincode', () => {
  it('keeps 6 digits', () => {
    expect(cleanPincode('56 00-01x9')).toBe('560001');
  });

  it('checks a branch pincode list, all-India delivery and an empty entry', () => {
    const branch = { serviceable_pincodes: ['560 001'], delivery_mode: 'pincode' as const };
    expect(pincodeServiceable(branch, '560001')).toBe(true);
    expect(pincodeServiceable(branch, '110001')).toBe(false);
    expect(pincodeServiceable(branch, '')).toBe(true);
    expect(pincodeServiceable({ ...branch, delivery_mode: 'all_india' }, '110001')).toBe(true);
    expect(pincodeServiceable({ serviceable_pincodes: [], delivery_mode: 'radius' }, '110001')).toBe(true);
  });

  it('shows the pincode, else a named branch, else the prompt', () => {
    expect(pincodeLine('560001', 'Main', 'Shop')).toBe('Deliver to 560001');
    expect(pincodeLine('', 'Koramangala', 'Shop')).toBe('Koramangala');
    expect(pincodeLine('', 'Shop', 'Shop')).toBe('Set delivery pincode');
    expect(pincodeLine('', undefined, 'Shop')).toBe('Set delivery pincode');
  });
});
