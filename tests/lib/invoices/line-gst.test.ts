import { computeLineGst, isZeroRatedWithoutTax } from '@/lib/invoices/line-gst';
import { supplierPayableAmount } from '@/lib/purchases/supplier-payable';
import { financialYearBounds } from '@/lib/purchases/duplicate-supplier-bill';

describe('isZeroRatedWithoutTax', () => {
  it('treats export under LUT as zero-rated', () => {
    expect(isZeroRatedWithoutTax({ is_export: true, export_type: 'wop' })).toBe(true);
    expect(isZeroRatedWithoutTax({ place_of_supply_state_code: '96', lut_declaration: true })).toBe(true);
    expect(isZeroRatedWithoutTax({ supply_type: 'sez_wop' })).toBe(true);
  });

  it('charges IGST on export / SEZ with payment', () => {
    expect(isZeroRatedWithoutTax({ is_export: true, export_type: 'wp' })).toBe(false);
    expect(isZeroRatedWithoutTax({ supply_type: 'sez_wp', lut_declaration: true })).toBe(false);
  });

  it('ignores LUT flag on domestic supplies', () => {
    expect(isZeroRatedWithoutTax({ place_of_supply_state_code: '29', lut_declaration: true })).toBe(false);
  });
});

describe('computeLineGst', () => {
  it('rounds each head to paise so totals reconcile', () => {
    const r = computeLineGst({ quantity: 3, unit_price: 333.33, tax_rate: 18 }, true, false);
    expect(r.taxable).toBe(999.99);
    expect(r.cgst).toBe(90);
    expect(r.sgst).toBe(90);
    expect(r.taxAmount).toBe(180);
    expect(r.lineTotal).toBe(1179.99);
  });

  it('applies line discount before tax', () => {
    const r = computeLineGst({ quantity: 2, unit_price: 500, discount_percent: 10, tax_rate: 12 }, false, false);
    expect(r.itemDiscount).toBe(100);
    expect(r.taxable).toBe(900);
    expect(r.igst).toBe(108);
  });

  it('charges no tax on zero-rated lines', () => {
    const r = computeLineGst({ quantity: 1, unit_price: 10000, tax_rate: 18 }, false, true);
    expect(r.igst).toBe(0);
    expect(r.lineTotal).toBe(10000);
  });
});

describe('supplierPayableAmount', () => {
  it('excludes self-assessed tax under reverse charge', () => {
    expect(supplierPayableAmount(11800, 1800, true)).toBe(10000);
    expect(supplierPayableAmount(11800, 1800, false)).toBe(11800);
  });
});

describe('financialYearBounds', () => {
  it('splits on 1 April', () => {
    expect(financialYearBounds('2026-03-31')).toEqual(['2025-04-01', '2026-04-01']);
    expect(financialYearBounds('2026-04-01')).toEqual(['2026-04-01', '2027-04-01']);
  });
});
