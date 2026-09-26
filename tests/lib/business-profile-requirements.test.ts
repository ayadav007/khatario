import {
  getInvoiceProfileContext,
  getProfileGaps,
} from '@/lib/business-profile-requirements';

describe('getInvoiceProfileContext', () => {
  it('does not require GSTIN for unregistered tax invoices', () => {
    expect(getInvoiceProfileContext('tax_invoice', 'unregistered')).toBe(
      'print_or_finalize_invoice'
    );
  });

  it('requires GSTIN for registered tax invoices', () => {
    expect(getInvoiceProfileContext('tax_invoice', 'regular')).toBe(
      'finalize_gst_invoice'
    );
  });
});

describe('getProfileGaps', () => {
  it('treats address complete without GSTIN for print_or_finalize_invoice', () => {
    const gaps = getProfileGaps(
      {
        name: 'Shop',
        address_line1: '1 Main St',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        gstin: '',
      },
      'print_or_finalize_invoice'
    );
    expect(gaps.map((g) => g.key)).toEqual([]);
  });
});
