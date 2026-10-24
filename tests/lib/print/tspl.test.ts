import { buildLabelTspl, pickFont } from '@/lib/print/tspl';
import { DEFAULT_ROLL_TEMPLATE } from '@/lib/label-document-builder';
import type { MonoBitmap } from '@/lib/print/bitmap';

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('TSPL labels', () => {
  const line = { productName: 'Basmati "Gold" Rice', barcode: '8901234567890', price: 590, copies: 3 };

  it('sets label size, gap and prints each line with its copies', () => {
    const out = text(buildLabelTspl({ template: DEFAULT_ROLL_TEMPLATE, lines: [line], businessName: 'Shree Ganesh' }));
    expect(out).toContain('SIZE 50 mm,25 mm');
    expect(out).toContain('GAP 2 mm,0 mm');
    expect(out).toContain('CLS');
    expect(out).toContain('PRINT 1,3');
    expect(out).toContain('BARCODE ');
    expect(out).toContain('\\["]Gold\\["]');
  });

  it('draws non-English text as a bitmap when a rasterizer is given', () => {
    const fake = (): MonoBitmap => ({ width: 16, height: 2, data: new Uint8Array([0xff, 0x00, 0x0f, 0xf0]) });
    const out = buildLabelTspl({
      template: DEFAULT_ROLL_TEMPLATE,
      lines: [{ ...line, productName: 'बासमती चावल' }],
      businessName: 'Shop',
      rasterize: fake,
    });
    const s = text(out);
    expect(s).toMatch(/BITMAP \d+,\d+,2,2,0,/);
    expect(s).not.toContain('बासमती');
  });

  it('falls back to readable ASCII without a rasterizer', () => {
    const s = text(buildLabelTspl({ template: DEFAULT_ROLL_TEMPLATE, lines: [{ ...line, productName: 'Chai ₹' }], businessName: '' }));
    expect(s).toContain('Chai Rs');
  });

  it('picks a built-in font for the wanted height', () => {
    expect(pickFont(24)).toMatchObject({ id: '3', mul: 1 });
    expect(pickFont(100)).toMatchObject({ id: '5', mul: 2 });
  });
});
