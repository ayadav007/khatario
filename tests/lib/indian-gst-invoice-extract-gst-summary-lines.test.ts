import {
  coerceRawInvoiceJson,
  normalizeIndianGstInvoiceExtract,
  type ExtractedInvoiceLine,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function minimalExtract(overrides: Partial<IndianGstInvoiceExtract>): IndianGstInvoiceExtract {
  return {
    supplier_name: 'Test',
    supplier_gstin: '27AAAAA0000A1Z5',
    buyer_gstin: null,
    invoice_number: '1',
    invoice_date: null,
    place_of_supply: 'MH',
    tax_type: 'cgst_sgst',
    price_mode: 'exclusive',
    subtotal: null,
    total_cgst: null,
    total_sgst: null,
    total_igst: null,
    round_off: null,
    grand_total: 325.5,
    gst_summary: [],
    items: [],
    ...overrides,
  };
}

describe('recomputeGstSummaryFromAuthoritativeLines (via normalize)', () => {
  it('replaces footer gst_summary with rollups from lines (CGST/SGST)', () => {
    const input = minimalExtract({
      items: [
        {
          description: 'Rice',
          hsn_code: '1006',
          qty: 1,
          unit: 'kg',
          rate: 100,
          discount_amount: null,
          gst_rate: 0,
          tax_mode: null,
          taxable_value: null,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
          line_total: 220.5,
          discount_on_tax_inclusive: false,
        },
        {
          description: 'Tea',
          hsn_code: '0902',
          qty: 1,
          unit: 'PCS',
          rate: 100,
          discount_amount: null,
          gst_rate: 5,
          tax_mode: null,
          taxable_value: 100,
          cgst_amount: 2.5,
          sgst_amount: 2.5,
          igst_amount: null,
          line_total: 105,
          discount_on_tax_inclusive: false,
        },
      ],
    });
    const out = normalizeIndianGstInvoiceExtract(input);
    const byRate = new Map(out.gst_summary.map((r) => [r.gst_rate, r]));
    expect(byRate.get(0)?.taxable_value).toBe(220.5);
    expect(byRate.get(0)?.total_tax).toBe(0);
    expect(byRate.get(5)?.taxable_value).toBe(100);
    expect(byRate.get(5)?.cgst).toBe(2.5);
    expect(byRate.get(5)?.sgst).toBe(2.5);
    expect(out.subtotal).toBe(320.5);
    expect(round2((out.total_cgst ?? 0) + (out.total_sgst ?? 0))).toBe(5);
  });

  it('uses IGST split when tax_type is igst', () => {
    const input = minimalExtract({
      total_cgst: 0,
      total_sgst: 0,
      total_igst: 0,
      subtotal: 0,
      grand_total: 118,
      supplier_gstin: '29AAAAA0000A1Z5',
      buyer_gstin: '09BBBBB0000B1Z0',
      items: [
        {
          description: 'Goods',
          hsn_code: '1234',
          qty: 1,
          unit: 'PCS',
          rate: 100,
          discount_amount: null,
          gst_rate: 18,
          tax_mode: null,
          taxable_value: 100,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: 18,
          line_total: 118,
          discount_on_tax_inclusive: false,
        },
      ],
    });
    const out = normalizeIndianGstInvoiceExtract(input);
    expect(out.gst_summary).toHaveLength(1);
    const row = out.gst_summary[0];
    expect(row.gst_rate).toBe(18);
    expect(row.taxable_value).toBe(100);
    expect(row.igst).toBe(18);
    expect(row.cgst).toBe(0);
    expect(row.sgst).toBe(0);
    expect(out.total_igst).toBe(18);
  });
});

describe('consolidated foreign / sales tax → CGST+SGST halves', () => {
  const lineExclusiveNoSplit = (): ExtractedInvoiceLine => ({
    description: 'Widget',
    hsn_code: null,
    qty: 1,
    unit: 'PCS',
    rate: 5250,
    discount_amount: null,
    gst_rate: null,
    tax_mode: null,
    taxable_value: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: 5250,
    discount_on_tax_inclusive: null,
  });

  const lineInclusiveUniform20 = (): ExtractedInvoiceLine => ({
    description: 'Widget',
    hsn_code: null,
    qty: 1,
    unit: 'PCS',
    rate: null,
    discount_amount: null,
    gst_rate: 20,
    tax_mode: 'inclusive',
    taxable_value: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: 6300,
    discount_on_tax_inclusive: null,
  });

  it('infers combined % from taxable vs grand gap and allocates 50/50 CGST/SGST', () => {
    const input = minimalExtract({
      grand_total: 6300,
      subtotal: 5250,
      price_mode: 'exclusive',
      gst_summary: [],
      items: [lineExclusiveNoSplit()],
    });
    const out = normalizeIndianGstInvoiceExtract(input);
    expect(out.document_combined_gst_rate).toBeCloseTo(20, 4);
    expect(out.total_cgst).toBeCloseTo(525, 2);
    expect(out.total_sgst).toBeCloseTo(525, 2);
    expect(out.items[0]!.gst_rate).toBeCloseTo(20, 4);
    expect(out.items[0]!.line_total).toBeCloseTo(6300, 2);
    expect(out.items[0]!.cgst_amount).toBeCloseTo(525, 2);
    expect(out.items[0]!.sgst_amount).toBeCloseTo(525, 2);
    expect(round2((out.total_cgst ?? 0) + (out.total_sgst ?? 0))).toBeCloseTo(1050, 2);
  });

  it('handles tax-inclusive totals with uniform combined % printed on lines', () => {
    const input = minimalExtract({
      grand_total: 6300,
      subtotal: null,
      price_mode: 'inclusive',
      gst_summary: [],
      items: [lineInclusiveUniform20()],
    });
    const out = normalizeIndianGstInvoiceExtract(input);
    expect(out.document_combined_gst_rate).toBeCloseTo(20, 4);
    expect(out.total_cgst).toBeCloseTo(525, 2);
    expect(out.total_sgst).toBeCloseTo(525, 2);
    expect(out.items[0]!.line_total).toBeCloseTo(6300, 2);
    expect(round2((out.total_cgst ?? 0) + (out.total_sgst ?? 0))).toBeCloseTo(1050, 2);
  });

  it('coerce preserves a non-standard combined % instead of snapping to an Indian slab', () => {
    const out = coerceRawInvoiceJson({
      items: [{ description: 'x', qty: 1, unit: 'PCS', gst_rate: 20, line_total: 100 }],
    });
    expect(out.items[0]!.gst_rate).toBe(20);
  });
});

describe('B2B footer: bill-level discount + asymmetric CGST/SGST', () => {
  it('rebuilds taxable from grand, scales lines, rolls up unequal CGST vs SGST', () => {
    const input = minimalExtract({
      supplier_name: 'SKPS',
      supplier_gstin: '07AAAAA0000A1Z5',
      buyer_gstin: '09BBBBB0000B1Z5',
      tax_type: null,
      price_mode: 'exclusive',
      grand_total: 39750.18,
      subtotal: 34914.52,
      total_cgst: 3110.88,
      total_sgst: 2073.92,
      total_igst: null,
      gst_summary: [],
      items: [
        {
          description: 'Item 2',
          hsn_code: '2541',
          qty: 26,
          unit: 'PCS',
          rate: 235.52,
          discount_amount: null,
          gst_rate: null,
          tax_mode: null,
          taxable_value: null,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
          line_total: 6123.52,
          discount_on_tax_inclusive: null,
        },
        {
          description: 'Item 3',
          hsn_code: '4944',
          qty: 2,
          unit: 'PCS',
          rate: 658,
          discount_amount: null,
          gst_rate: null,
          tax_mode: null,
          taxable_value: null,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
          line_total: 1316,
          discount_on_tax_inclusive: null,
        },
        {
          description: 'Item 4',
          hsn_code: '2546',
          qty: 50,
          unit: 'PCS',
          rate: 485,
          discount_amount: null,
          gst_rate: null,
          tax_mode: null,
          taxable_value: null,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
          line_total: 24250,
          discount_on_tax_inclusive: null,
        },
        {
          description: 'Item 5',
          hsn_code: '8151',
          qty: 15,
          unit: 'PCS',
          rate: 215,
          discount_amount: null,
          gst_rate: null,
          tax_mode: null,
          taxable_value: null,
          cgst_amount: null,
          sgst_amount: null,
          igst_amount: null,
          line_total: 3225,
          discount_on_tax_inclusive: null,
        },
      ],
    });

    const out = normalizeIndianGstInvoiceExtract(input);
    expect(out.tax_type).toBe('cgst_sgst');
    expect(out.subtotal).toBeCloseTo(34565.38, 1);
    expect(out.total_cgst).toBeCloseTo(3110.88, 2);
    expect(out.total_sgst).toBeCloseTo(2073.92, 2);
    expect((out.total_igst ?? 0) < 0.5).toBe(true);
    const row = out.gst_summary.find((r) => r.gst_rate > 0);
    expect(row).toBeDefined();
    expect(row!.cgst).toBeCloseTo(3110.88, 2);
    expect(row!.sgst).toBeCloseTo(2073.92, 2);
    expect(Math.abs(row!.cgst - row!.sgst)).toBeGreaterThan(100);
  });
});
