import { determineTaxType } from '@/lib/invoice-engine/determineTaxType';

describe('determineTaxType supply kind', () => {
  it('charges IGST on an SEZ supply in the same state', () => {
    const tax = determineTaxType({
      businessStateCode: '29',
      placeOfSupply: 'Karnataka',
      isExport: false,
      documentType: 'tax_invoice',
      supplyKind: 'sez',
    });
    expect(tax.useCGSTSGST).toBe(false);
    expect(tax.isIGST).toBe(true);
    expect(tax.isNonTaxable).toBe(false);
  });

  it('charges no GST on an exempt supply', () => {
    const tax = determineTaxType({
      businessStateCode: '29',
      placeOfSupply: 'Karnataka',
      isExport: false,
      documentType: 'tax_invoice',
      supplyKind: 'exempt',
    });
    expect(tax.isNonTaxable).toBe(true);
    expect(tax.useCGSTSGST).toBe(false);
  });
});
