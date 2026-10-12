import { amountInWords } from '@/lib/print-language/amount';
import { applyDocumentLanguageEntitlement } from '@/lib/print-language/codes';
import { embedPrintPhrases, renderLocalizedPrintHtml } from '@/lib/print-language/apply';
import { translatePhrase } from '@/lib/print-language/labels';
import { translatePrintedItemName } from '@/lib/print-language/item-name';

describe('print language', () => {
  it('prints English when the plan does not include print language', () => {
    expect(applyDocumentLanguageEntitlement('hi', false)).toBe('en');
    expect(applyDocumentLanguageEntitlement('hi', true)).toBe('hi');
  });

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
    expect(translatePhrase('hi', 'Item name')).toBe('वस्तु का नाम');
  });

  it('translates the whole Item name heading, not only the word Item', () => {
    const html = renderLocalizedPrintHtml('<html><body><th>Item name</th><td>Water Bottle</td></body></html>', {}, 'hi');
    expect(html).toContain('वस्तु का नाम');
    expect(html).toContain('Water Bottle');
    expect(html).not.toContain('वस्तु name');
  });

  it('translates tally invoice headings that were only partly replaced', () => {
    const source = [
      '<html><body>',
      '<div>Invoice Details:</div>',
      '<th>Item name</th><th>HSN/SAC</th><th>Price/Unit(₹)</th><th>Disc(₹)</th><th>GST(₹)</th>',
      '<div>Tax Summary:</div><th>Taxable amount (₹)</th><th>Total Tax (₹)</th><th>Amt (₹)</th>',
      '<td>Water Bottle</td><div>Payment is due within 30 days.</div>',
      '</body></html>',
    ].join('');
    const html = renderLocalizedPrintHtml(source, {}, 'hi');
    expect(html).toContain('बीजक विवरण:');
    expect(html).toContain('वस्तु का नाम');
    expect(html).toContain('मूल्य/इकाई(₹)');
    expect(html).toContain('छूट(₹)');
    expect(html).toContain('कर सारांश:');
    expect(html).toContain('करयोग्य राशि (₹)');
    expect(html).toContain('कुल कर (₹)');
    expect(html).toContain('राशि (₹)');
    expect(html).toContain('HSN/SAC');
    expect(html).toContain('GST(₹)');
    expect(html).toContain('Water Bottle');
    expect(html).toContain('Payment is due within 30 days.');
  });

  it('translates a printed item name into the selected language', () => {
    expect(translatePrintedItemName('hi', 'Water Bottle')).toBe('पानी की बोतल');
    expect(translatePrintedItemName('hi', 'Rice')).toBe('चावल');
    expect(translatePrintedItemName('hinglish', 'Water Bottle')).toBe('Paani ki botal');
    expect(translatePrintedItemName('hinglish', 'Rice')).toBe('Chawal');
    expect(translatePrintedItemName('mr', 'Water Bottle')).toBe('पाण्याची बाटली');
    expect(translatePrintedItemName('mr', 'Rice')).toBe('तांदूळ');
    expect(translatePrintedItemName('gu', 'Rice')).toBe('ચોખા');
    expect(translatePrintedItemName('ta', 'Rice')).toBe('அரிசி');
    expect(translatePrintedItemName('te', 'Rice')).toBe('బియ్యం');
    expect(translatePrintedItemName('kn', 'Rice')).toBe('ಅಕ್ಕಿ');
    expect(translatePrintedItemName('ml', 'Rice')).toBe('അരി');
    expect(translatePrintedItemName('bn', 'Rice')).toBe('চাল');
    expect(translatePrintedItemName('pa', 'Rice')).toBe('ਚਾਵਲ');
    expect(translatePrintedItemName('or', 'Rice')).toBe('ଚାଉଳ');
    expect(translatePrintedItemName('ur', 'Rice')).toBe('چاول');
    expect(translatePrintedItemName('en', 'Water Bottle')).toBe('Water Bottle');
    expect(translatePrintedItemName('hi', 'चावल')).toBe('चावल');
    expect(translatePrintedItemName('hi', 'Basmati Rice')).toBe('बासमती चावल');
    expect(translatePrintedItemName('hi', 'Acme Widget')).toBe('Acme Widget');
  });
});
