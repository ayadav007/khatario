import { EscPosBuilder } from '@/lib/bluetooth/escpos';
import { buildLabelDocumentZpl } from '@/lib/zpl-generator';
import { DEFAULT_ROLL_TEMPLATE, type LabelTemplate } from '@/lib/label-document-builder';
import { blankBitmap, needsRaster, type RasterTextOptions, type TextRasterizer } from '@/lib/print/bitmap';

/** Fake rasterizer: a solid block 8 dots wide per character, so positions are easy to check. */
const calls: Array<{ text: string; options: RasterTextOptions }> = [];
const fakeRaster: TextRasterizer = (text, options) => {
  calls.push({ text, options });
  const bmp = blankBitmap(Math.min(options.maxWidthDots, [...text].length * 8), options.heightDots);
  bmp.data.fill(0xff);
  return bmp;
};

const GS_V_0 = [0x1d, 0x76, 0x30, 0x00];
const indexOfSeq = (bytes: Uint8Array, seq: number[]) =>
  bytes.findIndex((_, i) => seq.every((b, j) => bytes[i + j] === b));

beforeEach(() => calls.splice(0));

describe('Indian text on receipt printers', () => {
  it('knows which text needs drawing', () => {
    expect(needsRaster('Toor Dal 1kg')).toBe(false);
    expect(needsRaster('तूर दाल')).toBe(true);
    expect(needsRaster('₹ 165')).toBe(true);
  });

  it('prints English lines as printer text and Hindi lines as an image', () => {
    const english = new EscPosBuilder({ paperWidthMm: 58, rasterize: fakeRaster }).line('Toor Dal').build();
    expect(indexOfSeq(english, GS_V_0)).toBe(-1);

    const hindi = new EscPosBuilder({ paperWidthMm: 58, rasterize: fakeRaster }).line('तूर दाल').build();
    expect(indexOfSeq(hindi, GS_V_0)).toBeGreaterThanOrEqual(0);
    expect(calls[0].options).toMatchObject({ heightDots: 30, maxWidthDots: 384 });
  });

  it('keeps qty and amount columns in place on a Hindi item row', () => {
    const out = new EscPosBuilder({ paperWidthMm: 58, rasterize: fakeRaster })
      .columns([
        { text: 'तूर दाल', width: 19 },
        { text: '10', width: 4, align: 'right' },
        { text: '1,650.00', width: 9, align: 'right' },
      ])
      .build();
    const at = indexOfSeq(out, GS_V_0);
    expect(at).toBeGreaterThanOrEqual(0);
    // Full-width row image: 384 dots = 48 bytes per row.
    expect(out[at + 4]).toBe(48);
    // Each cell is drawn within its own slot (12 dots per character).
    expect(calls.map((c) => c.options.maxWidthDots)).toEqual([19 * 12, 4 * 12, 9 * 12]);
  });

  it('falls back to ASCII without a rasterizer', () => {
    const out = new EscPosBuilder({ paperWidthMm: 58 }).line('₹ 165').build();
    expect(new TextDecoder().decode(out)).toContain('Rs 165');
  });
});

describe('Indian text on Zebra labels', () => {
  const line = { productName: 'बासमती चावल', barcode: '8901234567890', copies: 1, price: 590 };

  it('draws Hindi as a ^GFA image when a rasterizer is given', () => {
    const zpl = buildLabelDocumentZpl({ template: DEFAULT_ROLL_TEMPLATE, lines: [line], businessName: 'Shop', rasterize: fakeRaster });
    expect(zpl).toMatch(/\^GFA,\d+,\d+,\d+,[0-9A-F]+\^FS/);
    expect(zpl).not.toContain('बासमती');
  });

  it('prints a designer prefix once', () => {
    const t: LabelTemplate = {
      ...DEFAULT_ROLL_TEMPLATE,
      fields: [{ key: 'mrp', visible: true, x_mm: 2, y_mm: 2, w_mm: 40, h_mm: 4, prefix: '(', suffix: ')' }],
    };
    const zpl = buildLabelDocumentZpl({ template: t, lines: [{ ...line, mrp: 650 }], businessName: 'X' });
    expect(zpl).toContain('^FD(MRP Rs 650.00)^FS');
  });
});
