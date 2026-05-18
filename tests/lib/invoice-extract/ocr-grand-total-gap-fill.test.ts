import type { ExtractedInvoiceLine, IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import {
  buildPlainTableGapCandidates,
  largestUnusedPlausibleTableAmount,
  mergeMissingPlainLinesFromOcrGrandTotalGap,
} from '@/lib/services/invoice-extract/ocrGrandTotalGapFill';
import { applyOcrSectionGstToExtract } from '@/lib/services/invoice-extract/gstPropagationEngine';
import type { OcrLine } from '@/lib/services/invoice-extract/ocrLineTypes';

function line(text: string, y: number, overrides: Partial<OcrLine> = {}): OcrLine {
  return { text, x: 10, y, width: 400, height: 10, kind: 'noise', ...overrides };
}

function mk(desc: string, lt: number): ExtractedInvoiceLine {
  return {
    description: desc,
    hsn_code: null,
    qty: 1,
    unit: 'PCS',
    rate: lt,
    discount_amount: null,
    gst_rate: 0,
    tax_mode: 'exclusive',
    taxable_value: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: lt,
    discount_on_tax_inclusive: false,
  };
}

describe('largestUnusedPlausibleTableAmount', () => {
  const grand = 7226;
  const used = (v: number) => [240, 550, 460, 900, 390, 2300].some((x) => Math.abs(x - v) < 1);

  it('does not treat rate as a new line when line total is already extracted (230 vs 460)', () => {
    expect(largestUnusedPlausibleTableAmount('3 ) Bhathroom comot 230 460', grand, used)).toBeNull();
  });

  it('parses Indian hyphen paise style', () => {
    expect(largestUnusedPlausibleTableAmount('1 ) Falash Tank 240-00', 9000, () => false)).toBe(240);
    expect(largestUnusedPlausibleTableAmount('ubur charge 800-0', grand, used)).toBe(800);
  });

  it('drops OCR noise above grand (8367 next to 836)', () => {
    expect(largestUnusedPlausibleTableAmount('Pata. Bolt- 836 8367', grand, used)).toBe(836);
  });
});

describe('mergeMissingPlainLinesFromOcrGrandTotalGap (handwritten B2B)', () => {
  const baseExtract: IndianGstInvoiceExtract = {
    supplier_name: null,
    supplier_gstin: null,
    buyer_gstin: null,
    invoice_number: '287',
    invoice_date: '2024-10-28',
    place_of_supply: null,
    tax_type: 'cgst_sgst',
    price_mode: 'exclusive',
    subtotal: 4840,
    total_cgst: 0,
    total_sgst: 0,
    total_igst: 0,
    round_off: null,
    grand_total: 7226,
    items: [
      mk('Falash Tank Push Button', 240),
      mk('Zed Exp. Brash', 550),
      mk('Bhathroom comot', 460),
      mk('Preshar. Nat. umirarli Bras', 900),
      mk('Pipe. Zed. Exp-and Preshar Pipe', 390),
      mk('Plamber. charge.', 2300),
    ],
    gst_summary: [],
  };

  const ocrLines: OcrLine[] = [
    line('Sr. No PARTICULARS QTY', 441),
    line('1 ) Falash Tank Push Button - 1 sel - 240 240-', 480),
    line('2 ) Zed Exp . Brash 1 - 550 550-', 536),
    line('3 ) Bhathroom comot 230 460', 588),
    line('4 ) Preshar . Nat . umirarli Bras 900', 677),
    line('5 Pipe . Zed . Exp - and Preshar Pipe 2 195 390-', 771),
    line('6 Plamber . charge . 2300-', 827),
    line('Pata . Bolt- 836 8367', 887),
    line('7 ) Hew', 900),
    line('8 ) Hadrotics 750-', 950),
    line('. Das 750', 960),
    line('ubur charge 800-0', 1015),
    line('9 ) 800', 1016),
    line('7226-', 1296),
    line('Rupees in Word: Seven thousand', 1302),
  ];

  it('mines OCR for missing rows when sum(line_total) < grand_total (0% tax)', () => {
    const out = mergeMissingPlainLinesFromOcrGrandTotalGap(
      baseExtract.items,
      ocrLines,
      baseExtract
    );
    expect(out.length).toBe(9);
    const sums = out.reduce((s, it) => s + (it.line_total ?? 0), 0);
    expect(Math.round(sums * 100) / 100).toBe(7226);
    expect(out.some((it) => (it.description ?? '').includes('836'))).toBe(true);
  });

  it('buildPlainTableGapCandidates includes clustered 750 continuation', () => {
    const cands = buildPlainTableGapCandidates(ocrLines, 7226, baseExtract.items);
    const amts = cands.map((c) => c.amount).sort((a, b) => a - b);
    expect(amts).toContain(836);
    expect(amts).toContain(750);
    expect(amts).toContain(800);
  });

  it('runs inside applyOcrSectionGstToExtract', () => {
    const { extract } = applyOcrSectionGstToExtract(baseExtract, ocrLines, 2000);
    expect(extract.items.length).toBe(9);
  });
});

describe('mergeMissingPlainLinesFromOcrGrandTotalGap guards', () => {
  it('does nothing when line totals already match grand', () => {
    const items = [mk('A', 100), mk('B', 200)];
    const extract: Pick<
      IndianGstInvoiceExtract,
      'grand_total' | 'total_cgst' | 'total_sgst' | 'total_igst' | 'round_off' | 'price_mode' | 'tax_type'
    > = {
      grand_total: 300,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: 0,
      round_off: null,
      price_mode: 'exclusive',
      tax_type: 'cgst_sgst',
    };
    const out = mergeMissingPlainLinesFromOcrGrandTotalGap(items, [line('1 ) A 100-00', 10), line('2 ) B 200-00', 20)], extract);
    expect(out.length).toBe(2);
  });

  it('skips when header tax is material', () => {
    const items = [mk('A', 100)];
    const extract: Pick<
      IndianGstInvoiceExtract,
      'grand_total' | 'total_cgst' | 'total_sgst' | 'total_igst' | 'round_off' | 'price_mode' | 'tax_type'
    > = {
      grand_total: 118,
      total_cgst: 9,
      total_sgst: 9,
      total_igst: 0,
      round_off: null,
      price_mode: 'exclusive',
      tax_type: 'cgst_sgst',
    };
    const out = mergeMissingPlainLinesFromOcrGrandTotalGap(items, [line('noise 18', 10)], extract);
    expect(out.length).toBe(1);
  });
});
