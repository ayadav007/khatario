import { capitalGoodsSaleTax, quartersOrPartElapsed } from '@/lib/gst/capital-goods-sale';

describe('s.18(6) / Rule 40(2) — sale of capital goods (Run 11 L3)', () => {
  it('counts quarters or part thereof', () => {
    expect(quartersOrPartElapsed('2025-04-10', '2025-04-10')).toBe(0);
    expect(quartersOrPartElapsed('2025-04-10', '2025-04-11')).toBe(1);
    expect(quartersOrPartElapsed('2025-04-10', '2025-07-10')).toBe(1);
    expect(quartersOrPartElapsed('2025-04-10', '2025-07-11')).toBe(2);
    expect(quartersOrPartElapsed('2025-04-10', '2026-04-10')).toBe(4);
  });

  it('ITC-reduced amount higher than tax on sale value (QA-R10-FA1 style)', () => {
    const r = capitalGoodsSaleTax({
      itcTaken: 9000,
      purchaseInvoiceDate: '2025-04-10',
      saleDate: '2026-04-10',
      transactionValue: 20000,
      taxRate: 18,
    });
    expect(r.itcBased).toBe(7200);
    expect(r.transactionBased).toBe(3600);
    expect(r.payable).toBe(7200);
    expect(r.basis).toBe('itc_reduced');
  });

  it('tax on sale value higher than ITC-reduced amount', () => {
    const r = capitalGoodsSaleTax({
      itcTaken: 9000,
      purchaseInvoiceDate: '2020-04-10',
      saleDate: '2026-04-10',
      transactionValue: 30000,
      taxRate: 18,
    });
    expect(r.itcBased).toBe(0);
    expect(r.payable).toBe(5400);
    expect(r.basis).toBe('transaction_value');
  });

  it('asset with no ITC and exempt sale: nothing payable', () => {
    const r = capitalGoodsSaleTax({
      itcTaken: 0,
      purchaseInvoiceDate: '2025-04-10',
      saleDate: '2026-04-10',
      transactionValue: 30000,
      taxRate: 0,
    });
    expect(r.payable).toBe(0);
  });
});
