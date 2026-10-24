import { checkInvoiceCompliance } from '@/lib/invoices/invoice-compliance';
import { computeLineGst } from '@/lib/invoices/line-gst';
import { hsnRuleError } from '@/lib/gst/hsn-rules';
import { isAllowedGstRate } from '@/lib/gst/rates';

const base = {
  lines: [{ item_name: 'Widget', hsn_sac: '8471', tax_rate: 18 }],
  invoiceDate: '2026-09-20',
  status: 'final',
  documentType: 'tax_invoice',
  customerGstin: '27AAPFU0939F1ZV',
  placeOfSupply: null as string | null,
  isExport: false,
  turnoverAbove5Cr: false,
  today: '2026-09-27',
};

describe('checkInvoiceCompliance', () => {
  it('takes place of supply from the buyer GSTIN when none is given', () => {
    const r = checkInvoiceCompliance(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.placeOfSupply).toBe('27');
  });

  it('rejects a place of supply that conflicts with the GSTIN unless ship-to is confirmed', () => {
    const r = checkInvoiceCompliance({ ...base, placeOfSupply: '29' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('POS_GSTIN_MISMATCH');
    const shipTo = checkInvoiceCompliance({ ...base, placeOfSupply: '29', allowPosDifferentFromGstin: true });
    expect(shipTo.ok).toBe(true);
  });

  it('rejects a rate that is not a notified slab', () => {
    const r = checkInvoiceCompliance({ ...base, lines: [{ item_name: 'X', hsn_sac: '8471', tax_rate: 7 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_GST_RATE');
  });

  it('allows the old 12% slab only on documents before 22 Sep 2025', () => {
    expect(isAllowedGstRate(12, '2025-09-21')).toBe(true);
    expect(isAllowedGstRate(12, '2025-09-22')).toBe(false);
    expect(isAllowedGstRate(40)).toBe(true);
  });

  it('enforces 4-digit HSN on B2B below Rs 5 cr and 6 digits above', () => {
    expect(hsnRuleError({ hsn: '84', isB2B: true, turnoverAbove5Cr: false })).not.toBeNull();
    expect(hsnRuleError({ hsn: '8471', isB2B: true, turnoverAbove5Cr: false })).toBeNull();
    expect(hsnRuleError({ hsn: '', isB2B: false, turnoverAbove5Cr: false })).toBeNull();
    expect(hsnRuleError({ hsn: '8471', isB2B: false, turnoverAbove5Cr: true })).not.toBeNull();
    const r = checkInvoiceCompliance({ ...base, lines: [{ item_name: 'X', hsn_sac: '84', tax_rate: 18 }] });
    expect(r.ok).toBe(false);
  });

  it('falls back to the catalogue HSN when the line has none', () => {
    const r = checkInvoiceCompliance({
      ...base,
      lines: [{ item_name: 'X', hsn_sac: '', master_hsn_sac: '847130', tax_rate: 18 }],
    });
    expect(r.ok).toBe(true);
  });

  it('warns on a future-dated invoice', () => {
    const r = checkInvoiceCompliance({ ...base, invoiceDate: '2026-10-05' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBe(1);
  });
});

describe('computeLineGst with prices including GST', () => {
  it('carves taxable value out of the inclusive price so the line total is unchanged', () => {
    const line = computeLineGst({ quantity: 1, unit_price: 118, tax_rate: 18 }, true, false, true);
    expect(line.lineTotal).toBe(118);
    expect(line.taxable).toBe(100);
    expect(line.cgst + line.sgst).toBe(18);
  });

  it('keeps paise consistent when the split is uneven', () => {
    const line = computeLineGst({ quantity: 3, unit_price: 100, tax_rate: 5 }, true, false, true);
    expect(line.lineTotal).toBe(300);
    expect(Math.round((line.taxable + line.taxAmount) * 100) / 100).toBe(300);
    expect(Math.round((line.cgst + line.sgst) * 100) / 100).toBe(line.taxAmount);
  });
});
