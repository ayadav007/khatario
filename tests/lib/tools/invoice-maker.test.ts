import {
  calculateInvoice,
  amountInWords,
  emptyInvoiceDraft,
  parseInvoiceDraft,
  type InvoiceDraft,
} from '@/lib/tools/invoice-maker';
import { computeLineGst } from '@/lib/invoices/line-gst';
import { GST_RATE_SLABS } from '@/lib/gst/rates';

const today = '2026-11-12';
const draft = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  ...emptyInvoiceDraft(today),
  seller: { name: 'A', address: '', gstin: '', state: 'Madhya Pradesh' },
  buyer: { name: 'B', address: '', gstin: '', state: 'Madhya Pradesh' },
  lines: [{ description: 'Rice', hsn: '1006', quantity: '2', rate: '100', discountPercent: '', gstRate: 5 }],
  ...over,
});
it('splits CGST and SGST within a state', () => {
  const t = calculateInvoice(draft());
  expect(t.intraState).toBe(true);
  expect(t).toMatchObject({ taxable: 200, cgst: 5, sgst: 5, igst: 0, total: 210, roundOff: 0 });
});
it('uses IGST across states, and same-state when the buyer has no state', () => {
  expect(calculateInvoice(draft({ buyer: { name: 'B', address: '', gstin: '', state: 'Gujarat' } }))).toMatchObject({ intraState: false, igst: 10, cgst: 0 });
  expect(calculateInvoice(draft({ buyer: { name: 'B', address: '', gstin: '', state: '' } })).intraState).toBe(true);
});
it('agrees with the app for inclusive prices and discounts', () => {
  const line = { description: 'X', hsn: '', quantity: '3', rate: '118', discountPercent: '10', gstRate: 18 };
  const t = calculateInvoice(draft({ pricesIncludeGst: true, lines: [line] }));
  const app = computeLineGst({ quantity: 3, unit_price: 118, discount_percent: 10, tax_rate: 18 }, true, false, true);
  expect(t.lines[0]).toMatchObject({ taxable: app.taxable, cgst: app.cgst, sgst: app.sgst, lineTotal: app.lineTotal });
});
it('rounds the total to the rupee with a round-off line', () => {
  const t = calculateInvoice(draft({ lines: [{ description: 'Y', hsn: '', quantity: '1', rate: '99.7', discountPercent: '', gstRate: 0 }] }));
  expect(t.total).toBe(100); expect(t.roundOff).toBe(0.3);
});
it('ignores blank, zero and negative rows and treats text as zero', () => {
  const lines = [
    { description: '', hsn: '', quantity: '', rate: '', discountPercent: '', gstRate: 18 },
    { description: 'Z', hsn: '', quantity: '0', rate: '50', discountPercent: '', gstRate: 18 },
    { description: 'N', hsn: '', quantity: '-2', rate: '50', discountPercent: '', gstRate: 18 },
    { description: 'T', hsn: '', quantity: 'abc', rate: '50', discountPercent: '', gstRate: 18 },
    { description: 'Ok', hsn: '', quantity: '1', rate: '100', discountPercent: '', gstRate: 0.25 },
  ];
  const t = calculateInvoice(draft({ lines }));
  expect(t.lines.map((l) => l.index)).toEqual([4]);
  expect(t.taxable).toBe(100);
  expect(t.cgst + t.sgst).toBe(0.26); // 0.13 + 0.13, each head rounded to paise as in the app
});
it('writes amounts in Indian words', () => {
  expect(amountInWords(125450)).toBe('One lakh twenty-five thousand four hundred fifty rupees only');
  expect(amountInWords(23456789)).toBe('Two crore thirty-four lakh fifty-six thousand seven hundred eighty-nine rupees only');
  expect(amountInWords(0)).toBe('Zero rupees only');
  expect(amountInWords(101)).toBe('One hundred one rupees only');
});
it('handles large and edge amounts in words', () => {
  expect(amountInWords(990000000)).toBe('Ninety-nine crore rupees only');
  expect(amountInWords(1000000000)).toBe('One hundred crore rupees only');
  expect(amountInWords(100000)).toBe('One lakh rupees only');
  expect(amountInWords(21)).toBe('Twenty-one rupees only');
});
it('restores a fresh draft from broken storage', () => {
  expect(parseInvoiceDraft(null, today)).toEqual(emptyInvoiceDraft(today));
  expect(parseInvoiceDraft('{not json', today)).toEqual(emptyInvoiceDraft(today));
  expect(parseInvoiceDraft(JSON.stringify({ number: 'X-9' }), today).number).toBe('X-9');
  expect(parseInvoiceDraft(JSON.stringify({ number: 'X-9' }), today).lines).toHaveLength(1);
  const bad = parseInvoiceDraft(JSON.stringify({ lines: [{ gstRate: 12 }] }), today);
  expect(GST_RATE_SLABS as readonly number[]).toContain(bad.lines[0].gstRate); // unknown rate falls back to 18
});
it('survives hostile storage values', () => {
  for (const raw of ['null', '42', '"x"', '[]', '{"lines":"no"}', '{"seller":5,"buyer":null,"number":7}', '{"lines":[null,3,"a"]}']) {
    const d = parseInvoiceDraft(raw, today);
    expect(typeof d.number).toBe('string');
    expect(typeof d.seller.name).toBe('string');
    expect(d.lines.length).toBeGreaterThanOrEqual(1);
  }
  const many = parseInvoiceDraft(JSON.stringify({ lines: Array.from({ length: 5000 }, () => ({})) }), today);
  expect(many.lines).toHaveLength(200);
  const typed = parseInvoiceDraft(JSON.stringify({ pricesIncludeGst: 'yes', seller: { name: 5, state: 'Goa' } }), today);
  expect(typed.pricesIncludeGst).toBe(false);
  expect(typed.seller.name).toBe('');
  expect(typed.seller.state).toBe('Goa');
  expect(parseInvoiceDraft(JSON.stringify({ evil: 1, __proto__: { x: 1 } }), today)).toEqual(emptyInvoiceDraft(today));
});
it('reads very large amounts with a recursive crore part', () => {
  expect(amountInWords(10000000000)).toBe('One thousand crore rupees only');
  expect(amountInWords(20000000000)).toBe('Two thousand crore rupees only');
  expect(amountInWords(99000000000000)).toBe('Ninety-nine lakh crore rupees only');
  expect(amountInWords(99999999999999)).toBe('Ninety-nine lakh ninety-nine thousand nine hundred ninety-nine crore ninety-nine lakh ninety-nine thousand nine hundred ninety-nine rupees only');
});
it('does not count a line whose values are not finite', () => {
  const lines = [
    { description: 'Huge', hsn: '', quantity: '1e308', rate: '100', discountPercent: '', gstRate: 18 },
    { description: 'Ok', hsn: '', quantity: '1', rate: '100', discountPercent: '', gstRate: 0 },
  ];
  const t = calculateInvoice(draft({ lines }));
  expect(t.lines.map((l) => l.index)).toEqual([1]);
  expect(Number.isFinite(t.total)).toBe(true);
  expect(t.totalInWords).toBe('One hundred rupees only');
});
it('skips lines above the 1e12 cap and keeps the invoice total finite and readable', () => {
  const big = (quantity: string, rate: string) => ({ description: 'B', hsn: '', quantity, rate, discountPercent: '', gstRate: 0 });
  const t = calculateInvoice(draft({ lines: [big('1e12', '1e12'), big('1000000000001', '1'), big('1', '100')] }));
  expect(t.lines.map((l) => l.index)).toEqual([2]);
  const two = calculateInvoice(draft({ lines: [big('1000000000000', '60'), big('1000000000000', '60')] }));
  expect(two.lines.map((l) => l.index)).toEqual([0]);
  expect(Number.isFinite(two.total)).toBe(true);
  expect(two.totalInWords).not.toBe('Zero rupees only');
});
it('reports the parsed quantity, rate and discount for each counted line', () => {
  const t = calculateInvoice(draft({ lines: [{ description: 'Q', hsn: '', quantity: '2', rate: 'abc', discountPercent: '5', gstRate: 5 }] }));
  expect(t.lines[0]).toMatchObject({ quantity: 2, rate: 0, discountPercent: 5 });
});
