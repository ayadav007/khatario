import {
  findItemByBarcode,
  searchCatalogCustomers,
  searchCatalogItems,
} from '@/lib/offline/catalog/search-helpers';
import type { CatalogCustomer, CatalogItemSearchResult } from '@/lib/offline/catalog/types';

const sampleItems: CatalogItemSearchResult[] = [
  {
    id: '1',
    name: 'Widget Alpha',
    code: 'WGT-01',
    barcode: '8901234567890',
    unit: 'PCS',
    selling_price: 100,
    tax_rate: 18,
    current_stock: 5,
    has_variants: false,
  },
  {
    id: '2',
    name: 'Shirt Blue',
    unit: 'PCS',
    selling_price: 500,
    tax_rate: 12,
    current_stock: 2,
    has_variants: true,
    variants: [
      {
        id: 'v1',
        variant_name: 'M',
        attributes: {},
        selling_price: 500,
        current_stock: 1,
        barcode: 'VAR123456',
      },
    ],
  },
];

const sampleCustomers: CatalogCustomer[] = [
  {
    id: 'c1',
    business_id: 'b1',
    name: 'Akshat Traders',
    phone: '9876543210',
    opening_balance: 0,
    opening_balance_type: 'debit',
    credit_limit: 0,
    is_active: true,
  },
];

describe('catalog search helpers', () => {
  it('finds items by name', () => {
    const results = searchCatalogItems(sampleItems, 'widget');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Widget Alpha');
  });

  it('finds parent item barcode', () => {
    const match = findItemByBarcode(sampleItems, '8901234567890');
    expect(match?.item.id).toBe('1');
    expect(match?.variant).toBeUndefined();
  });

  it('finds variant barcode', () => {
    const match = findItemByBarcode(sampleItems, 'VAR123456');
    expect(match?.item.id).toBe('2');
    expect(match?.variant?.id).toBe('v1');
  });

  it('searches customers by phone', () => {
    const results = searchCatalogCustomers(sampleCustomers, '9876');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Akshat Traders');
  });
});
