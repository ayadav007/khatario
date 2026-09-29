import { effectiveGstScheme, outwardTaxPolicy, recipientMayClaimItc } from '@/lib/gst/scheme-policy';
import { computeInvoiceTotals } from '@/lib/invoices/validate-invoice-gst-payload';

const GSTIN_KA = '29AABCU9603R1ZM';

describe('effectiveGstScheme', () => {
  it('composition stays composition', () => {
    expect(effectiveGstScheme('composition', GSTIN_KA)).toBe('composition');
  });
  it('regular with GSTIN is regular', () => {
    expect(effectiveGstScheme('regular', GSTIN_KA)).toBe('regular');
  });
  it('no GSTIN means unregistered, whatever the flag says', () => {
    expect(effectiveGstScheme('regular', null)).toBe('unregistered');
    expect(effectiveGstScheme('unregistered', '')).toBe('unregistered');
    expect(effectiveGstScheme(null, null)).toBe('unregistered');
  });
  it('stale "unregistered" flag with a GSTIN on the registration is treated as regular', () => {
    expect(effectiveGstScheme('unregistered', GSTIN_KA)).toBe('regular');
  });
});

describe('outwardTaxPolicy (Rule 49, s.10(4), s.31(3)(c)) — Run 11 L1', () => {
  it('regular + tax invoice collects tax', () => {
    expect(outwardTaxPolicy({ scheme: 'regular', documentType: 'tax_invoice' })).toEqual({
      collectTax: true,
      documentType: 'tax_invoice',
    });
  });
  it('regular + bill of supply never collects tax', () => {
    const p = outwardTaxPolicy({ scheme: 'regular', documentType: 'bill_of_supply' });
    expect(p.collectTax).toBe(false);
    expect(p.documentType).toBe('bill_of_supply');
  });
  it.each(['composition', 'unregistered'] as const)('%s: tax invoice is issued as a bill of supply without tax', (scheme) => {
    const p = outwardTaxPolicy({ scheme, documentType: 'tax_invoice' });
    expect(p.collectTax).toBe(false);
    expect(p.documentType).toBe('bill_of_supply');
    expect(p.warning).toMatch(/Bill of Supply/);
  });
  it.each(['composition', 'unregistered'] as const)('%s: bill of supply collects no tax, no warning', (scheme) => {
    const p = outwardTaxPolicy({ scheme, documentType: 'bill_of_supply' });
    expect(p).toEqual({ collectTax: false, documentType: 'bill_of_supply', warning: undefined });
  });
  it('composition estimate stays an estimate, without tax', () => {
    const p = outwardTaxPolicy({ scheme: 'composition', documentType: 'proforma_invoice' });
    expect(p.documentType).toBe('proforma_invoice');
    expect(p.collectTax).toBe(false);
  });
});

describe('computeInvoiceTotals — bill of supply carries no tax', () => {
  const line = (over: Record<string, unknown> = {}) => ({ item_name: 'X', quantity: 1, unit_price: 1000, tax_rate: 18, ...over });
  const body = (document_type: string, pos: string, items = [line()], extra: Record<string, unknown> = {}) => ({
    business_id: 'b',
    created_by: 'u',
    invoice_date: '2026-09-01',
    document_type,
    place_of_supply_state_code: pos,
    items,
    ...extra,
  });

  it.each([
    ['intra-state goods', '29', [line()]],
    ['inter-state goods', '27', [line()]],
    ['intra-state service (SAC)', '29', [line({ hsn_sac: '998314' })]],
    ['inter-state service (SAC)', '27', [line({ hsn_sac: '998314' })]],
  ])('%s', (_label, pos, items) => {
    const t = computeInvoiceTotals(body('bill_of_supply', pos as string, items as any) as any, '29');
    expect(t.taxTotal).toBe(0);
    expect(t.cgstTotal + t.sgstTotal + t.igstTotal).toBe(0);
    expect(t.subtotal).toBe(1000);
    expect(t.grandTotal).toBe(1000);
  });

  it('GST-inclusive price on a bill of supply: whole amount is value, no tax carved out', () => {
    const t = computeInvoiceTotals(body('bill_of_supply', '29', [line({ unit_price: 1180 })], { prices_include_gst: true }) as any, '29');
    expect(t.taxTotal).toBe(0);
    expect(t.grandTotal).toBe(1180);
  });

  it('tax invoice (regular) still charges tax: intra CGST+SGST, inter IGST', () => {
    const intra = computeInvoiceTotals(body('tax_invoice', '29') as any, '29');
    expect(intra.cgstTotal).toBe(90);
    expect(intra.sgstTotal).toBe(90);
    const inter = computeInvoiceTotals(body('tax_invoice', '27') as any, '29');
    expect(inter.igstTotal).toBe(180);
  });
});

describe('recipientMayClaimItc (s.10(4)) — Run 11 L2', () => {
  it('only a regular taxpayer takes ITC', () => {
    expect(recipientMayClaimItc('regular')).toBe(true);
    expect(recipientMayClaimItc('composition')).toBe(false);
    expect(recipientMayClaimItc('unregistered')).toBe(false);
  });
});
