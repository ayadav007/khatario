import { effectiveSupplyType, einvoiceApplies } from '@/lib/gst/einvoice-settings';

describe('effectiveSupplyType', () => {
  const base = { supply_type: null, is_export: false, place_of_supply_state_code: '27', customer_gstin: null };

  it('keeps the stored supply type when the invoice has one', () => {
    expect(effectiveSupplyType({ ...base, supply_type: 'b2c_large', customer_gstin: '27ABCDE1234F2Z5' })).toBe('b2c_large');
    expect(effectiveSupplyType({ ...base, supply_type: 'sez' })).toBe('sez');
    expect(effectiveSupplyType({ ...base, supply_type: ' deemed_export ' })).toBe('deemed_export');
  });

  it('treats an invoice without one as an export when it is marked export or its place of supply is 96', () => {
    expect(effectiveSupplyType({ ...base, is_export: true })).toBe('export');
    expect(effectiveSupplyType({ ...base, place_of_supply_state_code: '96', customer_gstin: '27ABCDE1234F2Z5' })).toBe('export');
  });

  it('treats it as B2B when the invoice or the customer has a real GSTIN', () => {
    expect(effectiveSupplyType({ ...base, customer_gstin: '27abcde1234f2z5' })).toBe('b2b');
    expect(effectiveSupplyType(base, '27ABCDE1234F2Z5')).toBe('b2b');
    // The copy on the invoice wins over the customer record.
    expect(effectiveSupplyType({ ...base, customer_gstin: 'URP' }, '27ABCDE1234F2Z5')).toBe('b2c');
  });

  it('treats it as B2C without a GSTIN, or with URP', () => {
    expect(effectiveSupplyType(base)).toBe('b2c');
    expect(effectiveSupplyType({ ...base, customer_gstin: '  ' }, '')).toBe('b2c');
    expect(effectiveSupplyType({ ...base, customer_gstin: null }, 'URP')).toBe('b2c');
    expect(effectiveSupplyType({ ...base, supply_type: '' })).toBe('b2c');
  });

  it('makes an invoice without a stored supply type and with a GSTIN need an e-invoice', () => {
    const inv = { status: 'final', document_type: 'tax_invoice', invoice_date: '2026-11-01' };
    expect(einvoiceApplies({ ...inv, supply_type: effectiveSupplyType({ ...base, customer_gstin: '27ABCDE1234F2Z5' }) }, '2026-04-01')).toBe(true);
    expect(einvoiceApplies({ ...inv, supply_type: effectiveSupplyType(base) }, '2026-04-01')).toBe(false);
  });
});
