import {
  canTransition,
  computeChallanLines,
  isChallanEditable,
} from '@/lib/delivery-challans/challan-math';

describe('computeChallanLines', () => {
  const items = [
    { item_name: 'Parley G', qty: 6, unit_price: 10, tax_rate: 0 },
    { item_name: 'Rajma 500g', qty: 2, unit_price: 79.52, tax_rate: 5 },
  ];

  it('splits tax into CGST and SGST within the state', () => {
    const { lines, totals } = computeChallanLines(items, { interState: false, chargeTax: true });
    expect(lines[1]).toMatchObject({ taxable_value: 159.04, tax_amount: 7.95, cgst_amount: 3.98, sgst_amount: 3.97, igst_amount: 0 });
    expect(totals).toEqual({
      subtotal: 219.04,
      cgst_total: 3.98,
      sgst_total: 3.97,
      igst_total: 0,
      tax_total: 7.95,
      grand_total: 226.99,
    });
  });

  it('charges IGST across states', () => {
    const { totals } = computeChallanLines(items, { interState: true, chargeTax: true });
    expect(totals.igst_total).toBe(7.95);
    expect(totals.cgst_total + totals.sgst_total).toBe(0);
  });

  it('shows no tax for suppliers who cannot charge it', () => {
    const { lines, totals } = computeChallanLines(items, { interState: false, chargeTax: false });
    expect(lines.every((l) => l.tax_rate === 0 && l.tax_amount === 0)).toBe(true);
    expect(totals.grand_total).toBe(219.04);
  });

  it('drops blank and zero-quantity rows, and accepts quantity as an alias', () => {
    const { lines } = computeChallanLines(
      [
        { item_name: '', qty: 3, unit_price: 1 },
        { item_name: 'Zero', qty: 0, unit_price: 5 },
        { name: 'Alias', quantity: '4', unit_price: '2.5' },
      ],
      { interState: false, chargeTax: true }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ item_name: 'Alias', qty: 4, taxable_value: 10 });
  });
});

describe('challan status rules', () => {
  it('allows the normal flow and cancelling open challans', () => {
    expect(canTransition('draft', 'sent')).toBe(true);
    expect(canTransition('sent', 'delivered')).toBe(true);
    expect(canTransition('draft', 'cancelled')).toBe(true);
    expect(canTransition('sent', 'cancelled')).toBe(true);
  });

  it('treats delivered and cancelled as final', () => {
    expect(canTransition('draft', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'sent')).toBe(false);
    expect(isChallanEditable('delivered')).toBe(false);
    expect(isChallanEditable('cancelled')).toBe(false);
    expect(isChallanEditable('sent')).toBe(true);
  });
});
