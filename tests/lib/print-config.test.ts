import { getPageCSS, resolvePrintConfig } from '@/lib/print-config';

describe('print page margins', () => {
  it('writes the saved sheet margins into @page so PDF keeps them', () => {
    const config = resolvePrintConfig('tally_style', {
      page_size: 'A4',
      orientation: 'portrait',
      margin_top: 10,
      margin_right: 12,
      margin_bottom: 14,
      margin_left: 8,
    });

    expect(config.puppeteer.margin).toEqual({
      top: '10mm',
      right: '12mm',
      bottom: '14mm',
      left: '8mm',
    });
    expect(config.puppeteer.preferCSSPageSize).toBe(true);
    expect(getPageCSS(config)).toContain('margin: 10mm 12mm 14mm 8mm;');
    expect(getPageCSS(config)).not.toContain('margin: 0');
  });

  it('keeps thermal rolls flush with the paper', () => {
    const config = resolvePrintConfig('thermal_80mm', {
      margin_top: 10,
      margin_right: 10,
      margin_bottom: 10,
      margin_left: 10,
    });

    expect(getPageCSS(config)).toContain('margin: 0;');
    expect(config.puppeteer.margin.left).toBe('0mm');
  });
});
