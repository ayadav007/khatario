import { DEFAULT_INVOICE_DEFAULTS, sanitizeInvoiceDefaults } from '@/lib/settings/invoice-defaults';

describe('sanitizeInvoiceDefaults', () => {
  test('empty input gives the defaults', () => {
    expect(sanitizeInvoiceDefaults(null)).toEqual(DEFAULT_INVOICE_DEFAULTS);
  });

  test('keeps valid values and clamps the rest', () => {
    expect(
      sanitizeInvoiceDefaults({
        dueDays: '15',
        pricesIncludeGst: true,
        roundOff: 'yes',
        quantityDecimals: 9,
        notes: 'Thanks',
        terms: 'x'.repeat(3000),
        lowStockAlert: '5',
      }),
    ).toEqual({
      dueDays: 15,
      pricesIncludeGst: true,
      roundOff: false,
      quantityDecimals: 2,
      notes: 'Thanks',
      terms: 'x'.repeat(2000),
      lowStockAlert: 5,
    });
  });

  test('a blank due date and low-stock level mean none', () => {
    expect(sanitizeInvoiceDefaults({ dueDays: '', lowStockAlert: '' })).toMatchObject({ dueDays: null, lowStockAlert: null });
    expect(sanitizeInvoiceDefaults({ dueDays: -3 }).dueDays).toBe(0);
  });
});
