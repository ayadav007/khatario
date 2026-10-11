import { amountInWords } from '@/lib/print-language/amount';
import { embedPrintPhrases, renderLocalizedPrintHtml } from '@/lib/print-language/apply';
import { translatePhrase } from '@/lib/print-language/labels';

describe('print language', () => {
  it('keeps English amount in words in the existing form', () => {
    expect(amountInWords(5630, 'en')).toBe('Five Thousand Six Hundred Thirty Rupees Only');
    expect(amountInWords(0, 'en')).toBe('Zero Rupees Only');
  });

  it('writes Hindi rupees with lakh-crore grouping', () => {
    expect(amountInWords(5630, 'hi')).toBe('पाँच हज़ार छह सौ तीस रुपये मात्र');
  });

  it('leaves GST codes and mustache fields untouched', () => {
    const source = `<style>.total{color:red}</style><div>Billed To</div><div>GSTIN: {{business.gstin}}</div><div>{{invoice.invoice_title}}</div>`;
    const embedded = embedPrintPhrases(source);
    expect(embedded).toContain('.total{color:red}');
    expect(embedded).toContain('{{t "billed_to"}}');
    expect(embedded).toContain('GSTIN: {{business.gstin}}');
    expect(embedded).toContain('{{invoice.invoice_title}}');
  });

  it('renders English templates without rewriting them', () => {
    const source = '<html><body><div>Billed To</div><div>GSTIN: {{business.gstin}}</div></body></html>';
    const html = renderLocalizedPrintHtml(source, { business: { gstin: '27AAAAA0000A1Z5' } }, 'en');
    expect(html).toContain('Billed To');
    expect(html).toContain('GSTIN: 27AAAAA0000A1Z5');
    expect(html).not.toContain('khatario-print-lang');
  });

  it('translates a heading and keeps the GSTIN line', () => {
    const source = '<html><head></head><body><div>Billed To</div><div>GSTIN: {{business.gstin}}</div></body></html>';
    const html = renderLocalizedPrintHtml(source, { business: { gstin: '27AAAAA0000A1Z5' } }, 'hi');
    expect(html).toContain('बिल प्राप्तकर्ता');
    expect(html).toContain('GSTIN: 27AAAAA0000A1Z5');
    expect(html).toContain('lang="hi"');
    expect(translatePhrase('hi', 'TAX INVOICE')).toBe('कर बीजक');
    expect(translatePhrase('hi', 'GSTIN')).toBe('GSTIN');
  });
});
