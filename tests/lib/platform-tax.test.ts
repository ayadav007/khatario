jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));

import {
  buildTaxBreakdown,
  buyerStateCodeOf,
  computeTax,
  computeTaxPaise,
  documentKind,
  splitGst,
  type GstMode,
} from '@/lib/platform-tax';
import { renderReceiptHtml, escapeHtml, type ReceiptData } from '@/lib/platform-receipt';

const s = (mode: GstMode, ratePercent = 18) => ({ mode, ratePercent });

describe('computeTax', () => {
  // [mode, amount in rupees, taxable, tax, payable]
  const table: [GstMode, number, number, number, number][] = [
    ['none', 299, 299, 0, 299],
    ['none', 1, 1, 0, 1],
    ['none', 4499, 4499, 0, 4499],
    ['inclusive', 299, 253.39, 45.61, 299],
    ['inclusive', 1, 0.85, 0.15, 1],
    ['inclusive', 4499, 3812.71, 686.29, 4499],
    ['exclusive', 299, 299, 53.82, 352.82],
    ['exclusive', 1, 1, 0.18, 1.18],
    ['exclusive', 4499, 4499, 809.82, 5308.82],
  ];
  it.each(table)('%s at ₹%s gives taxable %s, tax %s, payable %s', (mode, amount, taxable, tax, payable) => {
    const r = computeTax(amount, s(mode));
    expect(r).toEqual({ taxable, tax, payable });
    // the identity, in paise so floating point cannot hide a difference
    expect(Math.round(r.taxable * 100) + Math.round(r.tax * 100)).toBe(Math.round(r.payable * 100));
  });

  it('none never changes the amount whatever the saved rate is', () => {
    for (const rate of [0, 5, 18, 28]) {
      for (const paise of [0, 1, 99, 100, 29900, 449900]) {
        expect(computeTaxPaise(paise, s('none', rate))).toEqual({ taxablePaise: paise, taxPaise: 0, payablePaise: paise });
      }
    }
  });

  it('inclusive never changes the amount; exclusive never changes the taxable part', () => {
    for (const paise of [100, 101, 5000, 29900, 123457]) {
      expect(computeTaxPaise(paise, s('inclusive')).payablePaise).toBe(paise);
      expect(computeTaxPaise(paise, s('exclusive')).taxablePaise).toBe(paise);
    }
  });

  it('taxable + tax = payable for every amount and rate tried', () => {
    for (const mode of ['inclusive', 'exclusive'] as GstMode[]) {
      for (const rate of [0, 0.25, 2.5, 5, 12, 18, 28]) {
        for (let paise = 0; paise <= 3000; paise += 7) {
          const r = computeTaxPaise(paise, s(mode, rate));
          expect(r.taxablePaise + r.taxPaise).toBe(r.payablePaise);
          expect(r.taxPaise).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('rounds half a paisa up (the one rounding rule)', () => {
    // 25 paise at 18 % = 4.5 paise -> 5
    expect(computeTaxPaise(25, s('exclusive')).taxPaise).toBe(5);
    // 11 paise at 18 % = 1.98 -> 2; 2 paise at 18 % = 0.36 -> 0
    expect(computeTaxPaise(11, s('exclusive')).taxPaise).toBe(2);
    expect(computeTaxPaise(2, s('exclusive')).taxPaise).toBe(0);
  });

  it('a zero rate adds and backs out nothing', () => {
    expect(computeTaxPaise(29900, s('exclusive', 0))).toEqual({ taxablePaise: 29900, taxPaise: 0, payablePaise: 29900 });
    expect(computeTaxPaise(29900, s('inclusive', 0))).toEqual({ taxablePaise: 29900, taxPaise: 0, payablePaise: 29900 });
  });
});

describe('place of supply and the CGST / SGST / IGST split', () => {
  it('splits an odd paisa so the halves add up exactly', () => {
    expect(splitGst(5382, true)).toEqual({ cgstPaise: 2691, sgstPaise: 2691, igstPaise: 0 });
    expect(splitGst(4561, true)).toEqual({ cgstPaise: 2280, sgstPaise: 2281, igstPaise: 0 });
    for (let t = 1; t < 500; t++) {
      const x = splitGst(t, true);
      expect(x.cgstPaise + x.sgstPaise).toBe(t);
    }
  });
  it('uses IGST for another state', () => {
    expect(splitGst(5382, false)).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 5382 });
  });
  it('same state -> CGST + SGST; different state -> IGST; unknown buyer state -> IGST', () => {
    const seller = { mode: 'exclusive' as const, ratePercent: 18, sellerStateCode: '29' };
    expect(buildTaxBreakdown(29900, seller, '29')).toMatchObject({ intraState: true, cgstPaise: 2691, sgstPaise: 2691, igstPaise: 0 });
    expect(buildTaxBreakdown(29900, seller, '27')).toMatchObject({ intraState: false, igstPaise: 5382, cgstPaise: 0 });
    expect(buildTaxBreakdown(29900, seller, null)).toMatchObject({ intraState: false, igstPaise: 5382 });
    expect(buildTaxBreakdown(29900, { ...seller, sellerStateCode: null }, '29')).toMatchObject({ intraState: false, igstPaise: 5382 });
  });
  it('mode none has no split and no rate', () => {
    expect(buildTaxBreakdown(29900, { mode: 'none', ratePercent: 18, sellerStateCode: '29' }, '29')).toMatchObject({
      taxPaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, ratePercent: 0,
    });
  });
  it('the buyer state comes from the GSTIN first, then the saved code, then the state name', () => {
    expect(buyerStateCodeOf({ gstin: '27AAAPA1234A1Z5', state_code: '29', state: 'Goa' })).toBe('27');
    expect(buyerStateCodeOf({ gstin: null, state_code: '29', state: 'Goa' })).toBe('29');
    expect(buyerStateCodeOf({ gstin: '', state_code: null, state: 'Karnataka' })).toBe('29');
    expect(buyerStateCodeOf({ gstin: null, state_code: null, state: null })).toBeNull();
    expect(buyerStateCodeOf({ gstin: 'XX', state_code: '99x', state: 'Nowhere' })).toBeNull();
  });
});

describe('document title', () => {
  it('"Tax invoice" only when GST was charged or included', () => {
    expect(documentKind('payment', 'none')).toBe('receipt');
    expect(documentKind('payment', undefined)).toBe('receipt');
    expect(documentKind('payment', 'inclusive')).toBe('tax_invoice');
    expect(documentKind('payment', 'exclusive')).toBe('tax_invoice');
    expect(documentKind('refund', 'none')).toBe('refund_receipt');
    expect(documentKind('refund', 'exclusive')).toBe('credit_note');
  });
});

describe('receipt HTML', () => {
  const base: ReceiptData = {
    kind: 'receipt',
    title: 'Receipt',
    mode: 'none',
    isRefund: false,
    number: 'KH/2026-27/000001',
    issuedOn: '27 Nov 2026',
    seller: { name: 'Khatario', address: null, gstin: null, sac: null },
    buyer: { name: 'Acme', gstin: null, address: null, placeOfSupply: null },
    description: 'Growth plan - monthly',
    planName: 'Growth',
    period: { start: '2026-11-27', end: '2026-12-27' },
    paymentMethod: 'razorpay',
    paymentReference: 'pay_1',
    originalNumber: null,
    originalDate: null,
    lines: { listPrice: 299, discount: 0, credit: 0, taxable: 299, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 299, rate: 0 },
  };
  it('escapes every interpolated value', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderReceiptHtml({
      ...base,
      buyer: { name: evil, gstin: evil, address: evil, placeOfSupply: evil },
      seller: { name: evil, address: evil, gstin: evil, sac: evil },
      description: evil,
      paymentReference: evil,
      number: evil,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });
  it('mode none says Receipt and never "Tax invoice" or a GST line', () => {
    const html = renderReceiptHtml(base);
    expect(html).toContain('<h1>Receipt</h1>');
    expect(html).not.toMatch(/tax invoice/i);
    expect(html).not.toMatch(/GST|CGST|SGST|IGST|Taxable/);
    expect(html).toContain('This is a receipt for your payment.');
  });
  it('a taxed document is a Tax invoice with the stored split', () => {
    const html = renderReceiptHtml({
      ...base,
      kind: 'tax_invoice',
      title: 'Tax invoice',
      mode: 'exclusive',
      seller: { name: 'Khatario Pvt Ltd', address: 'Bengaluru', gstin: '29AAAAA0000A1Z5', sac: '998314' },
      buyer: { name: 'Acme', gstin: '27AAAPA1234A1Z5', address: null, placeOfSupply: 'Maharashtra (27)' },
      lines: { listPrice: 299, discount: 0, credit: 0, taxable: 299, cgst: 0, sgst: 0, igst: 53.82, tax: 53.82, total: 352.82, rate: 18 },
    });
    expect(html).toContain('<h1>Tax invoice</h1>');
    expect(html).toContain('IGST @ 18%');
    expect(html).toContain('53.82');
    expect(html).toContain('352.82');
    expect(html).toContain('GSTIN 29AAAAA0000A1Z5');
  });
});
