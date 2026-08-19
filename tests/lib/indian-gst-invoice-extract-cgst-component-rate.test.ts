import {
  combineCgstSgstComponentGstRate,
  normalizeIndianGstInvoiceExtract,
  type ExtractedInvoiceLine,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';

function line(overrides: Partial<ExtractedInvoiceLine> = {}): ExtractedInvoiceLine {
  return {
    description: 'Item',
    hsn_code: null,
    qty: 1,
    unit: 'PCS',
    rate: 100,
    discount_amount: null,
    gst_rate: null,
    tax_mode: null,
    taxable_value: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: 100,
    discount_on_tax_inclusive: false,
    ...overrides,
  };
}

function extract(overrides: Partial<IndianGstInvoiceExtract> = {}): IndianGstInvoiceExtract {
  return {
    supplier_name: 'Avenue Supermarts',
    supplier_gstin: '27AAAAA0000A1Z5',
    buyer_gstin: null,
    invoice_number: 'DM-1',
    invoice_date: '2026-06-01',
    place_of_supply: 'Maharashtra',
    tax_type: 'cgst_sgst',
    price_mode: 'exclusive',
    subtotal: null,
    total_cgst: null,
    total_sgst: null,
    total_igst: null,
    round_off: null,
    grand_total: null,
    gst_summary: [],
    items: [],
    ...overrides,
  };
}

describe('combineCgstSgstComponentGstRate', () => {
  it('A: CGST 2.5 + SGST 2.5 → total gst_rate 5', () => {
    expect(combineCgstSgstComponentGstRate(2.5, 'cgst_sgst')).toBe(5);
  });

  it('B: CGST 9 + SGST 9 → total gst_rate 18', () => {
    expect(combineCgstSgstComponentGstRate(9, 'cgst_sgst')).toBe(18);
  });

  it('F: IGST 9 stays 9 (does not double to 18)', () => {
    expect(combineCgstSgstComponentGstRate(9, 'igst')).toBe(9);
    expect(combineCgstSgstComponentGstRate(5, 'igst')).toBe(5);
  });

  it('already-total slabs are unchanged', () => {
    expect(combineCgstSgstComponentGstRate(5, 'cgst_sgst')).toBe(5);
    expect(combineCgstSgstComponentGstRate(18, 'cgst_sgst')).toBe(18);
    expect(combineCgstSgstComponentGstRate(0, 'cgst_sgst')).toBe(0);
  });
});

describe('normalizeIndianGstInvoiceExtract — CGST component vs blended smear', () => {
  it('C: mixed 0/5/18 line rates are kept (not one invoice-wide rate)', () => {
    const out = normalizeIndianGstInvoiceExtract(
      extract({
        subtotal: 300,
        total_cgst: 11.5,
        total_sgst: 11.5,
        grand_total: 323,
        items: [
          line({ description: 'Atta', gst_rate: 0, rate: 100, line_total: 100, taxable_value: 100 }),
          line({ description: 'Tea', gst_rate: 5, rate: 100, line_total: 100, taxable_value: 100 }),
          line({ description: 'Soap', gst_rate: 18, rate: 100, line_total: 100, taxable_value: 100 }),
        ],
      }),
    );
    expect(out.items.map((it) => it.gst_rate)).toEqual([0, 5, 18]);
    for (const it of out.items) {
      expect(it.gst_rate).not.toBeCloseTo(2.9, 1);
    }
  });

  it('D: D-Mart raw Gemini (gst_rate 0 / 2.5 / 9, price_mode inclusive) does not become 2.9% on every line', () => {
    const out = normalizeIndianGstInvoiceExtract(
      extract({
        price_mode: 'inclusive',
        subtotal: 2781.85,
        total_cgst: 40.29,
        total_sgst: 40.29,
        grand_total: 2862.43,
        items: [
          line({
            description: 'SONA MASURI',
            gst_rate: 0,
            rate: 42,
            qty: 1,
            line_total: 1000,
            taxable_value: 1000,
            tax_mode: 'inclusive',
          }),
          line({
            description: 'TATA AGNI TEA-1kg',
            gst_rate: 2.5,
            rate: 440,
            qty: 1,
            line_total: 440,
            taxable_value: 440,
            tax_mode: 'inclusive',
          }),
          line({
            description: 'BIRYANI RICE',
            gst_rate: 9,
            rate: 95,
            qty: 1,
            line_total: 1341.85,
            taxable_value: 1341.85,
            tax_mode: 'inclusive',
          }),
        ],
      }),
    );

    const byName = Object.fromEntries(out.items.map((it) => [it.description, it]));
    expect(byName['SONA MASURI']?.gst_rate).toBe(0);
    expect(byName['TATA AGNI TEA-1kg']?.gst_rate).toBe(5);
    expect(byName['BIRYANI RICE']?.gst_rate).toBe(18);
    for (const it of out.items) {
      expect(it.gst_rate).not.toBeCloseTo(2.9, 1);
    }
  });

  it('E: when no per-line GST exists, blended header-tax fallback still runs', () => {
    const out = normalizeIndianGstInvoiceExtract(
      extract({
        price_mode: 'exclusive',
        subtotal: 300,
        total_cgst: 4.35,
        total_sgst: 4.35,
        grand_total: 308.7,
        items: [
          line({ description: 'A', gst_rate: null, rate: 100, line_total: 100 }),
          line({ description: 'B', gst_rate: null, rate: 100, line_total: 100 }),
          line({ description: 'C', gst_rate: null, rate: 100, line_total: 100 }),
        ],
      }),
    );
    for (const it of out.items) {
      expect(it.gst_rate).toBeCloseTo(2.9, 1);
    }
  });

  it('F: IGST extract does not rewrite 18% into a CGST component or blended rate', () => {
    const out = normalizeIndianGstInvoiceExtract(
      extract({
        tax_type: 'igst',
        supplier_gstin: '27AAAAA0000A1Z5',
        buyer_gstin: '29BBBBB0000B1Z5',
        price_mode: 'exclusive',
        subtotal: 1000,
        total_cgst: null,
        total_sgst: null,
        total_igst: 180,
        grand_total: 1180,
        items: [
          line({
            description: 'Widget',
            gst_rate: 18,
            rate: 1000,
            line_total: 1180,
            taxable_value: 1000,
            igst_amount: 180,
            cgst_amount: 0,
            sgst_amount: 0,
          }),
        ],
      }),
    );
    expect(out.items[0]?.gst_rate).toBe(18);
    expect(out.tax_type).toBe('igst');
    expect(out.items[0]?.igst_amount).toBe(180);
  });
});
