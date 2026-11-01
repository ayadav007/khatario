import {
  applyStatutorySettings,
  buildHsnTaxSummary,
  copyLabelFor,
  lockedSettingKeys,
  parsePrintCopyParam,
  printCopiesFor,
} from '@/lib/invoice-statutory';
import { getDefaultTemplateSettings } from '@/lib/template-defaults';

const goods = [{ hsn_sac: '84713010' }, { hsn_sac: '996511' }];
const services = [{ hsn_sac: '998314' }, { hsn_sac: '996511' }];

describe('lockedSettingKeys', () => {
  it('locks GSTIN, HSN, place of supply, signature and reverse charge on a tax invoice', () => {
    const keys = lockedSettingKeys('tax_invoice', 'gst_standard');
    for (const k of ['show_business_gstin', 'show_customer_gstin', 'show_hsn', 'show_place_of_supply',
      'show_signature', 'show_authorized_signatory', 'show_reverse_charge', 'show_copy_label', 'show_hsn_summary']) {
      expect(keys).toContain(k);
    }
  });

  it('does not lock tax fields on a bill of supply', () => {
    const keys = lockedSettingKeys('bill_of_supply', 'composition_standard');
    expect(keys).toContain('show_hsn');
    expect(keys).toContain('show_signature');
    expect(keys).not.toContain('show_reverse_charge');
    expect(keys).not.toContain('show_hsn_summary');
  });

  it('locks nothing on proforma invoices, sales orders and challans', () => {
    expect(lockedSettingKeys('proforma_invoice', 'gst_standard')).toEqual([]);
    expect(lockedSettingKeys('sales_order', 'gst_standard')).toEqual([]);
    expect(lockedSettingKeys('delivery_challan', 'challan_standard')).toEqual([]);
  });

  it('asks thermal receipts for HSN only when the buyer has a GSTIN', () => {
    expect(lockedSettingKeys('tax_invoice', 'thermal_80mm')).not.toContain('show_hsn');
    expect(lockedSettingKeys('tax_invoice', 'thermal_80mm', { b2b: true })).toContain('show_hsn');
    expect(lockedSettingKeys('tax_invoice', 'thermal_58mm')).not.toContain('show_signature');
    expect(lockedSettingKeys('tax_invoice', 'thermal_58mm')).toContain('show_business_gstin');
  });
});

describe('applyStatutorySettings', () => {
  it('turns switched-off mandatory fields back on and leaves the rest alone', () => {
    const off = { show_business_gstin: false, show_hsn: false, show_signature: false, show_logo: false, primary_color: '#000' };
    const out = applyStatutorySettings(off, 'tax_invoice', 'modern');
    expect(out.show_business_gstin).toBe(true);
    expect(out.show_hsn).toBe(true);
    expect(out.show_signature).toBe(true);
    expect(out.show_logo).toBe(false);
    expect(out.primary_color).toBe('#000');
    expect(off.show_hsn).toBe(false);
  });
});

describe('copy labels', () => {
  it('labels goods invoices for recipient, transporter and supplier', () => {
    expect(copyLabelFor('tax_invoice', 'original', goods)).toBe('Original for Recipient');
    expect(copyLabelFor('tax_invoice', 'duplicate', goods)).toBe('Duplicate for Transporter');
    expect(copyLabelFor('tax_invoice', 'triplicate', goods)).toBe('Triplicate for Supplier');
    expect(printCopiesFor('tax_invoice', goods)).toEqual(['original', 'duplicate', 'triplicate']);
  });

  it('issues services-only invoices in duplicate', () => {
    expect(copyLabelFor('tax_invoice', 'duplicate', services)).toBe('Duplicate for Supplier');
    expect(printCopiesFor('tax_invoice', services)).toEqual(['original', 'duplicate']);
  });

  it('labels challans for consignee, transporter and consigner', () => {
    expect(copyLabelFor('delivery_challan', 'original', goods)).toBe('Original for Consignee');
    expect(copyLabelFor('delivery_challan', 'triplicate', goods)).toBe('Triplicate for Consigner');
  });

  it('gives quotations and orders no copy label', () => {
    expect(copyLabelFor('proforma_invoice', 'original', goods)).toBeNull();
    expect(copyLabelFor('sales_order', 'original', goods)).toBeNull();
    expect(printCopiesFor('purchase_order', goods)).toEqual([]);
  });

  it('reads the copy query parameter', () => {
    expect(parsePrintCopyParam('ALL')).toBe('all');
    expect(parsePrintCopyParam('duplicate')).toBe('duplicate');
    expect(parsePrintCopyParam('fourth')).toBeUndefined();
    expect(parsePrintCopyParam(null)).toBeUndefined();
  });
});

describe('buildHsnTaxSummary', () => {
  it('groups by HSN and rate and totals the columns', () => {
    const { rows, totals } = buildHsnTaxSummary([
      { hsn_sac: '8471', tax_rate: 18, taxable_value: '1000.00', cgst_amount: '90.00', sgst_amount: '90.00', tax_amount: '180.00' },
      { hsn_sac: '8471', tax_rate: 18, taxable_value: '500.00', cgst_amount: '45.00', sgst_amount: '45.00', tax_amount: '90.00' },
      { hsn_sac: '8471', tax_rate: 12, taxable_value: '100.00', cgst_amount: '6.00', sgst_amount: '6.00', tax_amount: '12.00' },
      { hsn_sac: '', tax_rate: 5, taxable_value: '200.00', cgst_amount: '5.00', sgst_amount: '5.00', tax_amount: '10.00' },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ hsn_sac: '8471', tax_rate: '18', cgst_rate: '9', taxable_value: '1500.00', cgst_amount: '135.00', total_tax: '270.00' });
    expect(rows[1]).toMatchObject({ hsn_sac: '8471', tax_rate: '12', cgst_rate: '6', taxable_value: '100.00' });
    expect(rows[2]).toMatchObject({ hsn_sac: 'N/A', cgst_rate: '2.5' });
    expect(totals).toEqual({ taxable_value: '1800.00', cgst_amount: '146.00', sgst_amount: '146.00', igst_amount: '0.00', total_tax: '292.00' });
  });

  it('works out taxable value from quantity, price and discount when it is missing', () => {
    const { rows } = buildHsnTaxSummary([{ hsn_sac: '2710', tax_rate: 18, quantity: 50, unit_price: 450, discount_amount: 2250 }]);
    expect(rows[0].taxable_value).toBe('20250.00');
  });
});

describe('template defaults', () => {
  it('prints the signature, copy label and HSN summary by default on A4, not on thermal', () => {
    const a4 = getDefaultTemplateSettings('gst_standard');
    expect(a4.show_signature).toBe(true);
    expect(a4.show_authorized_signatory).toBe(true);
    expect(a4.show_copy_label).toBe(true);
    expect(a4.show_hsn_summary).toBe(true);
    const thermal = getDefaultTemplateSettings('thermal_80mm');
    expect(thermal.show_signature).toBe(false);
    expect(thermal.show_hsn_summary).toBe(false);
  });
});
