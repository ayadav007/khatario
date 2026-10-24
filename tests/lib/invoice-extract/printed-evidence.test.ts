import { VISION_PROMPT } from '@/lib/gst-invoice-vision-prompt';
import { GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA } from '@/lib/invoice-extract/latency/gemini-invoice-response-schema';
import {
  coerceRawInvoiceJson,
  normalizeIndianGstInvoiceExtract,
  type IndianGstInvoiceExtract,
} from '@/lib/indian-gst-invoice-extract';
import { repairExtractSectionsDeterministic } from '@/lib/services/invoice-extract/repair/sectionRepairEngine';

function idli(): IndianGstInvoiceExtract {
  return {
    supplier_name: 'THE IDILI CAFE',
    supplier_gstin: '33ADVFS4469F1ZJ',
    buyer_gstin: null,
    invoice_number: '42',
    invoice_date: '2026-05-25',
    place_of_supply: null,
    tax_type: 'cgst_sgst',
    price_mode: 'inclusive',
    subtotal: null,
    total_cgst: null,
    total_sgst: null,
    total_igst: null,
    round_off: null,
    grand_total: 18,
    gst_summary: [],
    items: [
      {
        description: 'WATER BOTLE (1LTR)',
        hsn_code: null,
        qty: 1,
        unit: 'PCS',
        rate: 17.14,
        discount_amount: null,
        gst_rate: 5,
        tax_mode: null,
        taxable_value: 17.14,
        cgst_amount: 0.43,
        sgst_amount: 0.43,
        igst_amount: null,
        line_total: 17.14,
        discount_on_tax_inclusive: false,
      },
    ],
  };
}

describe('printed evidence survives extraction', () => {
  it('keeps unknown and omitted price modes distinct from exclusive', () => {
    const unknown = coerceRawInvoiceJson({ price_mode: 'unknown', grand_total: null, items: [] });
    expect(unknown.price_mode).toBeNull();
    expect(unknown.source_price_mode).toBe('unknown');

    const omitted = coerceRawInvoiceJson({ items: [] });
    expect(omitted.price_mode).toBeNull();
    expect(omitted.source_price_mode).toBeNull();

    const line = coerceRawInvoiceJson({
      items: [{ description: 'Active PO', qty: 1, rate: 80, tax_mode: 'unknown', line_total: null }],
    });
    expect(line.items[0].tax_mode).toBeNull();
    expect(line.items[0].source_tax_mode).toBe('unknown');
    expect(line.items[0].source_line_total).toBeNull();
    expect(line.printed_grand_total).toBeNull();
  });

  it('does not invent a payable when the footer total is missing', () => {
    const out = normalizeIndianGstInvoiceExtract({
      ...idli(),
      price_mode: null,
      grand_total: null,
      subtotal: 17.14,
      total_cgst: 0.43,
      total_sgst: 0.43,
    });
    expect(out.printed_grand_total).toBeNull();
    expect(out.grand_total).toBeNull();
  });

  it('keeps the Idli Café printed line amount after the exclusive repair rewrites line_total', () => {
    const repaired = repairExtractSectionsDeterministic(idli());
    const out = normalizeIndianGstInvoiceExtract(repaired.patched);
    expect(out.price_mode).toBe('exclusive');
    expect(out.items[0].line_total).toBeCloseTo(18, 2);
    expect(out.items[0].source_line_total).toBeCloseTo(17.14, 2);
    expect(out.items[0].source_rate).toBeCloseTo(17.14, 2);
    expect(out.items[0].source_taxable_value).toBeCloseTo(17.14, 2);
    expect(out.printed_grand_total).toBe(18);
    expect(out.source_price_mode).toBe('inclusive');
  });
});

describe('vision contract', () => {
  it('asks for unknown, column role, and does not treat a GST footer as the price mode', () => {
    expect(VISION_PROMPT).toContain("'unknown'");
    expect(VISION_PROMPT).toContain('not a purchased product');
    expect(VISION_PROMPT).toContain('true of BOTH kinds of invoice');
    expect(VISION_PROMPT).toContain('Do not invent a discount');
    const schema = JSON.stringify(GEMINI_INVOICE_EXTRACT_RESPONSE_SCHEMA);
    expect(schema).toContain('unknown');
    expect(schema).toContain('column_role');
    expect(schema).toContain('price_evidence');
    expect(schema).not.toContain('unit_price');
  });
});
