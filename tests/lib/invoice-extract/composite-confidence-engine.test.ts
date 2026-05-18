import type { FullTextAnnotation } from '@/lib/services/invoice-extract/vision-types';
import { parseSpatialDocument } from '@/lib/services/invoice-extract/ocrSpatialParser';
import type { IndianGstInvoiceExtract } from '@/lib/indian-gst-invoice-extract';
import type { InvoiceConfidenceContext } from '@/lib/services/invoice-extract/confidence';
import {
  calculateInvoiceConfidence,
  computeInvoiceValidationPillar,
  computeOcrPillar,
} from '@/lib/services/invoice-extract/confidence';

function fakeWord(text: string, minX: number, minY: number, maxX: number, maxY: number) {
  const chars = [...text];
  const symbols = chars.map((ch, i) => ({
    text: ch,
    boundingBox: {
      vertices: [
        { x: minX + i * 8, y: minY },
        { x: minX + (i + 1) * 8, y: minY },
        { x: minX + (i + 1) * 8, y: maxY },
        { x: minX + i * 8, y: maxY },
      ],
    },
  }));
  return {
    symbols,
    boundingBox: {
      vertices: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
    },
  };
}

function minimalAnnotationFromWords(
  words: Array<{ text: string; x: number; y: number; w: number; h: number }>,
): FullTextAnnotation {
  const visionWords = words.map((w) => fakeWord(w.text, w.x, w.y, w.x + w.w, w.y + w.h));
  return {
    pages: [
      {
        width: 800,
        height: 1200,
        blocks: [
          {
            paragraphs: [{ words: visionWords }],
          },
        ],
      },
    ],
    text: words.map((w) => w.text).join(' '),
  };
}

function stockLine(
  qty: number,
  rate: number,
  gst: number,
  lineTotal: number,
): IndianGstInvoiceExtract['items'][0] {
  return {
    description: 'Goods',
    hsn_code: '12345678',
    qty,
    unit: 'PCS',
    rate,
    discount_amount: 0,
    gst_rate: gst,
    tax_mode: 'exclusive',
    taxable_value: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    line_total: lineTotal,
    discount_on_tax_inclusive: false,
  };
}

function goodInvoice(): IndianGstInvoiceExtract {
  return {
    supplier_name: 'ACME India Pvt Ltd',
    supplier_gstin: '09AABCU9603R1Z7',
    buyer_gstin: '07BBBBB1234H1ZD',
    invoice_number: 'INV-9001',
    invoice_date: '2024-06-15',
    place_of_supply: '09',
    tax_type: 'cgst_sgst',
    price_mode: 'exclusive',
    subtotal: 1000,
    total_cgst: 90,
    total_sgst: 90,
    total_igst: null,
    round_off: 0,
    grand_total: 1180,
    gst_summary: [
      {
        gst_rate: 18,
        taxable_value: 1000,
        cgst: 90,
        sgst: 90,
        igst: 0,
        total_tax: 180,
      },
    ],
    items: [stockLine(10, 100, 18, 1180)],
  };
}

describe('composite confidence engine', () => {
  const prevEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of [
      'INVOICE_CONFIDENCE_AUTO_ACCEPT_MIN',
      'INVOICE_CONFIDENCE_WEIGHT_OCR',
      'INVOICE_CONFIDENCE_WEIGHT_VALIDATION',
      'INVOICE_CONFIDENCE_WEIGHT_HISTORICAL',
      'INVOICE_CONFIDENCE_WEIGHT_SEMANTIC',
    ]) {
      prevEnv[k] = process.env[k];
    }
    process.env.INVOICE_CONFIDENCE_AUTO_ACCEPT_MIN = '0.8';
    process.env.INVOICE_CONFIDENCE_WEIGHT_OCR = '0.25';
    process.env.INVOICE_CONFIDENCE_WEIGHT_VALIDATION = '0.35';
    process.env.INVOICE_CONFIDENCE_WEIGHT_HISTORICAL = '0.2';
    process.env.INVOICE_CONFIDENCE_WEIGHT_SEMANTIC = '0.2';
  });

  afterAll(() => {
    for (const k of Object.keys(prevEnv)) {
      const v = prevEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function baseCtxSpatial(anno: FullTextAnnotation): InvoiceConfidenceContext {
    return {
      gstPropagation: null,
      ocrGstSummary: { validation_confidence: 0.92, validation_warnings: 0 },
      spatial: parseSpatialDocument(anno) ?? undefined,
      semanticLines: [
        {
          confidence: 0.9,
          validation: { quantityRateAmountConsistent: true, suspicious: false },
        },
      ],
      headerAlignmentScore: 0.87,
      historical: undefined,
    };
  }

  it('valid GST invoice yields high invoice score and AUTO_ACCEPT', () => {
    const anno = minimalAnnotationFromWords([
      { text: 'Qty', x: 50, y: 200, w: 34, h: 16 },
      { text: 'Rate', x: 210, y: 198, w: 40, h: 17 },
      { text: 'Amount', x: 380, y: 200, w: 50, h: 17 },
      { text: '10', x: 55, y: 230, w: 26, h: 16 },
      { text: '100', x: 210, y: 230, w: 40, h: 16 },
      { text: '1180', x: 385, y: 228, w: 50, h: 18 },
    ]);
    const inv = goodInvoice();
    const r = calculateInvoiceConfidence(inv, baseCtxSpatial(anno));
    expect(r.confidence).toBeGreaterThan(0.8);
    expect(r.status).toBe('AUTO_ACCEPT');
    expect(r.confidence_breakdown.validation).toBeGreaterThan(0.75);
  });

  it('noisy OCR (low word scores) lowers OCR pillar vs clean spatial doc', () => {
    const anno = minimalAnnotationFromWords([
      { text: 'A', x: 10, y: 300, w: 20, h: 18 },
      { text: 'B', x: 40, y: 302, w: 22, h: 18 },
    ]);
    const clean = parseSpatialDocument(anno);
    expect(clean).not.toBeNull();

    const noisy = parseSpatialDocument(anno);
    expect(noisy).not.toBeNull();
    noisy!.words.forEach((w) => {
      Object.assign(w, { confidence: 0.06 });
    });

    const ocrClean = computeOcrPillar({
      spatial: clean ?? undefined,
      ocrGstSummary: { validation_confidence: 0.9, validation_warnings: 0 },
    });
    const ocrNoisy = computeOcrPillar({
      spatial: noisy ?? undefined,
      ocrGstSummary: { validation_confidence: 0.9, validation_warnings: 0 },
    });
    expect(ocrNoisy).toBeLessThan(ocrClean);
  });

  it('missing totals reduces validation pillar', () => {
    const inv = goodInvoice();
    const broken: IndianGstInvoiceExtract = {
      ...inv,
      grand_total: null,
    };
    const vGood = computeInvoiceValidationPillar(inv, null);
    const vBad = computeInvoiceValidationPillar(broken, null);
    expect(vBad).toBeLessThan(vGood);
  });

  it('GST slab taxable mismatch lowers validation pillar', () => {
    const inv = goodInvoice();
    const messed: IndianGstInvoiceExtract = {
      ...inv,
      gst_summary: [
        {
          gst_rate: 18,
          taxable_value: 50,
          cgst: 90,
          sgst: 90,
          igst: 0,
          total_tax: 180,
        },
      ],
    };
    expect(computeInvoiceValidationPillar(messed, null)).toBeLessThan(
      computeInvoiceValidationPillar(inv, null),
    );
  });
});
