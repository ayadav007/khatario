import type { ExtractedInvoiceLine, IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import {
  assignSectionGstRates,
  applyOcrSectionGstToExtract,
  inferNegativeLineTotalFromExchangeOcrText,
} from '@/lib/services/invoice-extract/gstPropagationEngine';
import { classifyOcrLineKind, isLikelyProductRowText } from '@/lib/services/invoice-extract/ocrLayoutService';
import { detectGstSections, parseGstRateFromSectionHeaderLine } from '@/lib/services/invoice-extract/gstSectionParser';
import { parseHeaderGstRate } from '@/lib/services/invoice-extract/gstHeaderParser';
import { scoreGstHeaderLikelihood } from '@/lib/services/invoice-extract/gstHeaderHeuristics';
import { detectInvoiceRegionsFromOcrLines } from '@/lib/services/invoice-extract/invoiceRegionDetector';
import type { OcrLine } from '@/lib/services/invoice-extract/ocrLineTypes';

function line(
  text: string,
  y: number,
  x = 10,
  overrides: Partial<OcrLine> = {}
): OcrLine {
  return { text, x, y, width: 400, height: 10, kind: 'noise', ...overrides };
}

describe('parseHeaderGstRate (OCR-tolerant)', () => {
  it.each([
    ['CGST @ 2.50%, SGST @ 2.50%', 5],
    ['CGST @2.5 SGST @2.5', 5],
    ['CGST:2.5% SGST:2.5%', 5],
    ['CGST 2.5 SGST 2.5', 5],
    ['CGST@9 SGST@9', 18],
    ['IGST18%', 18],
    ['GST 5%', 5],
    ['SLAB 12', 12],
    ['2) CGST @ 2.50%, SGST @ 2.50%', 5],
  ])('parses %s → %s', (input, expected) => {
    expect(parseHeaderGstRate(input)).toBe(expected);
    expect(parseGstRateFromSectionHeaderLine(input)).toBe(expected);
  });

  it('returns null for empty / garbage', () => {
    expect(parseHeaderGstRate('')).toBeNull();
    expect(parseHeaderGstRate('random text no tax')).toBeNull();
  });
});

describe('assignSectionGstRates', () => {
  const pageHeight = 1000;

  it('propagates DMart-style slab header onto following product rows', () => {
    const lines: OcrLine[] = [
      line('DMART INVOICE', 20),
      line('2) CGST @ 2.50%, SGST @ 2.50%', 80),
      line('4000911 Agni Tea 1.000 45.000 45.00', 100, 10, { kind: 'item' }),
      line('4000912 Milk 2.000 30.000 60.00', 120, 10, { kind: 'item' }),
    ];
    const { lines: out, trace } = assignSectionGstRates(lines, { pageHeight });
    expect(trace.detectedHeaders.length).toBeGreaterThanOrEqual(1);
    expect(trace.detectedHeaders[0].rate).toBe(5);
    const items = out.filter((l) => l.kind === 'item');
    expect(items.every((l) => l.assignedSectionGstRate === 5)).toBe(true);
  });

  it('does not restart section from footer GST summary rows', () => {
    const lines: OcrLine[] = [
      line('1) CGST @ 9%, SGST @ 9%', 100),
      line('1234567890123 Widget 1.000 100.000 118.00', 130, 10, { kind: 'item' }),
      line('CGST 2.5% 24.50 SGST 2.5% 24.50', 880, 10),
      line('4000999 Another 1.000 10.000 10.50', 900, 10, { kind: 'item' }),
    ];
    const { lines: out, trace } = assignSectionGstRates(lines, { pageHeight });
    expect(trace.footerIgnoredHeaders.length).toBeGreaterThanOrEqual(1);
    const lastItem = out.filter((l) => l.kind === 'item').pop();
    expect(lastItem?.assignedSectionGstRate).toBe(18);
  });

  it('blocks GST-looking lines after grand total (outside footer band)', () => {
    const lines: OcrLine[] = [
      line('CGST @ 2.5 SGST @ 2.5', 100),
      line('1111 Product 1.000 10.000 10.50', 120, 10, { kind: 'item' }),
      line('GRAND TOTAL 999.00', 600, 10),
      line('CGST @ 9 SGST @ 9', 620, 10),
      line('2222 Other 1.000 5.000 5.90', 640, 10, { kind: 'item' }),
    ];
    const { lines: out, trace } = assignSectionGstRates(lines, { pageHeight: 2000 });
    expect(trace.footerIgnoredHeaders.some((h) => h.reason === 'post_grand_total_gst_line')).toBe(true);
    const items = out.filter((l) => l.kind === 'item');
    expect(items[0].assignedSectionGstRate).toBe(5);
    expect(items[1].assignedSectionGstRate).toBe(5);
  });

  it('supports mixed slabs: next header stops previous propagation', () => {
    const lines: OcrLine[] = [
      line('CGST 2.5 SGST 2.5', 50),
      line('1111 A 1.000 10.000 10.50', 70, 10, { kind: 'item' }),
      line('CGST 9 SGST 9', 100),
      line('2222 B 1.000 20.000 23.60', 120, 10, { kind: 'item' }),
    ];
    const { lines: out } = assignSectionGstRates(lines, { pageHeight: 800 });
    const items = out.filter((l) => l.kind === 'item');
    expect(items[0].assignedSectionGstRate).toBe(5);
    expect(items[1].assignedSectionGstRate).toBe(18);
  });
});

describe('scoreGstHeaderLikelihood', () => {
  it('lowers score for marketing product noise', () => {
    const ph = 800;
    const regions = detectInvoiceRegionsFromOcrLines(
      [line('CGST 2.5 SGST 2.5', 200), line('Milk GST 5% Offer Save 10', 220)],
      ph
    );
    const good = scoreGstHeaderLikelihood(line('CGST 2.5 SGST 2.5', 200), { pageHeight: ph, regions });
    const bad = scoreGstHeaderLikelihood(line('Milk GST 5% Offer Save 10', 220), { pageHeight: ph, regions });
    expect(good).toBeGreaterThan(bad);
    expect(bad).toBeLessThan(0.58);
  });
});

describe('detectGstSections', () => {
  it('returns markers aligned with propagation acceptance', () => {
    const textLines = [
      { text: 'Header' },
      { text: 'CGST:2.5% SGST:2.5%' },
      { text: 'HSN Item 1.000 10.00 10.50' },
    ];
    const markers = detectGstSections(textLines);
    expect(markers.length).toBe(1);
    expect(markers[0].gstRate).toBe(5);
    expect(markers[0].lineIndex).toBe(1);
  });
});

describe('Flipkart-style IGST', () => {
  it('parses IGST-only interstate header', () => {
    expect(parseHeaderGstRate('IGST @ 18%')).toBe(18);
    expect(parseHeaderGstRate('IGST18%')).toBe(18);
  });
});

describe('Generic tabular OCR (e-invoices)', () => {
  it('detects Flipkart-like amount row as product, not totals strip', () => {
    const row =
      'Gaming Laptops Acer Predator Helios 300 1 84990.00 -24500.00 51262.70 9227.30 60490.00';
    expect(isLikelyProductRowText(row)).toBe(true);
    expect(classifyOcrLineKind(row)).toBe('item');

    const colHeader = 'Product Title Qty Gross Discount Taxable IGST Total';
    expect(classifyOcrLineKind(colHeader)).not.toBe('gst_header');

    const totalRow = 'Total 1 74990.00 -24500.00 41262.70 9227.30 50490.00';
    expect(isLikelyProductRowText(totalRow)).toBe(false);
  });

  it('propagates IGST to table row printed before the IGST % line; exchange stays 0%', () => {
    const ph = 900;
    const lines: OcrLine[] = [
      line('Tax Invoice', 100),
      line('Gaming Laptops Acer 1 84990.00 -24500.00 51262.70 9227.30 60490.00', 200),
      line('Warranty serial NHQ3HS10058160DCD03400', 250),
      line('IGST : 18.000 %', 300),
      line('Exchange Discount -10000.00 0.00 -10000.00 0.00 -10000.00', 350),
    ];
    const { lines: out, trace } = assignSectionGstRates(lines, { pageHeight: ph });
    const gaming = out.find((l) => l.text.includes('Gaming Laptops'));
    const ex = out.find((l) => l.text.includes('Exchange'));
    expect(gaming?.kind).toBe('item');
    expect(gaming?.assignedSectionGstRate).toBe(18);
    expect(ex?.kind).toBe('item');
    expect(ex?.assignedSectionGstRate).toBe(0);
    expect(trace.propagationSteps.some((s) => s.action === 'backfill_from_following_tax_label')).toBe(
      true
    );
  });
});

function mkLine(desc: string, hsn: string, lt: number, gst: number): ExtractedInvoiceLine {
  return {
    description: desc,
    hsn_code: hsn,
    qty: 1,
    unit: 'Kg',
    rate: 10,
    discount_amount: null,
    gst_rate: gst,
    tax_mode: 'exclusive',
    taxable_value: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: lt,
    discount_on_tax_inclusive: null,
  };
}

function minimalExtract(items: ExtractedInvoiceLine[]): IndianGstInvoiceExtract {
  return {
    supplier_name: null,
    supplier_gstin: null,
    buyer_gstin: null,
    invoice_number: null,
    invoice_date: null,
    place_of_supply: null,
    tax_type: 'cgst_sgst',
    price_mode: 'inclusive',
    subtotal: null,
    total_cgst: null,
    total_sgst: null,
    total_igst: null,
    round_off: null,
    grand_total: null,
    items,
    gst_summary: [],
  };
}

describe('applyOcrSectionGstToExtract (HSN + line pairing)', () => {
  it('does not let L CHANA steal L DAL CHANA OCR row (same HSN, LLM order ≠ receipt)', () => {
    const extract = minimalExtract([
      mkLine('L CHANA', '071320', 49.49, 5),
      mkLine('L DAL CHANA', '071320', 59.2, 5),
    ]);
    const ocrLines: OcrLine[] = [
      line('1) CGST @ 0.00%, SGST @ 0.00%', 10),
      line('071320 L DAL CHANA 0.800 74.00 59.20', 20, 10, { kind: 'item' }),
      line('071320 L CHANA 0.678 73.00 49.49', 30, 10, { kind: 'item' }),
    ];
    const { extract: out } = applyOcrSectionGstToExtract(extract, ocrLines, 400);
    expect(out.items[0].gst_rate).toBe(0);
    expect(out.items[1].gst_rate).toBe(0);
  });

  it('appends Exchange Discount when OCR has the row but Groq returned only the main product', () => {
    const extract = minimalExtract([
      mkLine('Acer Predator Helios 300 …', '84713010', 60490, 18),
    ]);
    extract.tax_type = 'igst';
    const ocrLines: OcrLine[] = [
      line('Gaming Laptops Acer … 1 84990.00 -24500.00 51262.70 9227.30 60490.00', 110, 10, { kind: 'item' }),
      line('IGST : 18.000 %', 120, 10, { kind: 'gst_header' }),
      line('Exchange Discount -10000.00 0.00 -10000.00 0.00 -10000.00', 130, 10, { kind: 'item' }),
    ];
    const { extract: out } = applyOcrSectionGstToExtract(extract, ocrLines, 2000);
    expect(out.items.length).toBe(2);
    const ex = out.items.find((it) => (it.description ?? '').toUpperCase().includes('EXCHANGE'));
    expect(ex?.line_total).toBe(-10000);
    expect(ex?.gst_rate).toBe(0);
    expect(ex?.igst_amount).toBe(0);
    expect(ex?.taxable_value).toBe(-10000);
  });
});

describe('inferNegativeLineTotalFromExchangeOcrText', () => {
  it('picks the most negative amount from a Flipkart-style row', () => {
    expect(
      inferNegativeLineTotalFromExchangeOcrText('Exchange Discount -10000.00 0.00 -10000.00 0.00 -10000.00')
    ).toBe(-10000);
  });
});
