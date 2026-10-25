import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import {
  closerToPrintedTotal,
  extractionTotalCheck,
  totalRecheckNote,
} from '@/lib/services/invoice-extract/totalRecheck';

function extract(overrides: Partial<IndianGstInvoiceExtract>): IndianGstInvoiceExtract {
  return {
    supplier_name: 'DMART',
    supplier_gstin: null,
    buyer_gstin: null,
    invoice_number: 'B-1',
    invoice_date: '2026-10-17',
    place_of_supply: null,
    tax_type: 'cgst_sgst',
    price_mode: 'inclusive',
    subtotal: null,
    total_cgst: null,
    total_sgst: null,
    total_igst: null,
    round_off: null,
    grand_total: 280.1,
    printed_grand_total: overrides.grand_total !== undefined ? overrides.grand_total : 280.1,
    items: [
      { description: 'SUGAR', hsn_code: null, qty: 3.7, unit: 'KGS', rate: 53, discount_amount: null, gst_rate: 5, tax_mode: 'inclusive', taxable_value: null, cgst_amount: null, sgst_amount: null, igst_amount: null, line_total: 196.1 },
      { description: 'SALT', hsn_code: null, qty: 3, unit: 'PCS', rate: 28, discount_amount: null, gst_rate: 0, tax_mode: 'inclusive', taxable_value: null, cgst_amount: null, sgst_amount: null, igst_amount: null, line_total: 84 },
    ],
    gst_summary: [],
    ...overrides,
  };
}

describe('extractionTotalCheck', () => {
  it('reports no gap when the lines add up to the printed total', () => {
    expect(extractionTotalCheck(extract({}))).toEqual({ printed: 280.1, linesTotal: 280.1, gap: null });
  });

  it('reports the gap when a line was misread', () => {
    const e = extract({});
    e.items[1] = { ...e.items[1], qty: 1, line_total: 28 };
    expect(extractionTotalCheck(e)).toEqual({ printed: 280.1, linesTotal: 224.1, gap: -56 });
  });

  it('counts the printed round off', () => {
    expect(extractionTotalCheck(extract({ round_off: -0.1, grand_total: 280 }))?.gap).toBeNull();
  });

  it('is null without a printed total or without lines', () => {
    expect(extractionTotalCheck(extract({ grand_total: null }))).toBeNull();
    expect(extractionTotalCheck(extract({ items: [] }))).toBeNull();
  });

  it('tries both price bases when the bill did not say which', () => {
    // 1000 before GST + 18% = 1180 payable; an unknown basis must not count as a gap.
    const e = extract({
      price_mode: null,
      grand_total: 1180,
      items: [{ description: 'DAL', hsn_code: null, qty: 10, unit: 'PCS', rate: 100, discount_amount: null, gst_rate: 18, tax_mode: null, taxable_value: null, cgst_amount: null, sgst_amount: null, igst_amount: null, line_total: 1000 }],
    });
    expect(extractionTotalCheck(e)?.gap).toBeNull();
  });
});

describe('second read helpers', () => {
  it('spells out the gap and the row count for the second read', () => {
    const note = totalRecheckNote({ printed: 2130.08, linesTotal: 2076.69, gap: -53.39 }, 15);
    expect(note).toContain('15 item rows');
    expect(note).toContain('₹2076.69');
    expect(note).toContain('₹2130.08');
    expect(note).toContain('₹53.39 missing');
  });

  it('keeps the read closer to the printed total, the first on a tie', () => {
    const first = { result: 'first', check: { printed: 100, linesTotal: 90, gap: -10 } };
    expect(closerToPrintedTotal(first, { result: 'second', check: { printed: 100, linesTotal: 100, gap: null } })).toBe('second');
    expect(closerToPrintedTotal(first, { result: 'second', check: { printed: 100, linesTotal: 80, gap: -20 } })).toBe('first');
    expect(closerToPrintedTotal(first, { result: 'second', check: { printed: 100, linesTotal: 110, gap: 10 } })).toBe('first');
    expect(closerToPrintedTotal(first, { result: 'second', check: null })).toBe('first');
  });
});
