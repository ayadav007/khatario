import { applyPosTenders } from '@/lib/pos-tender';

describe('applyPosTenders', () => {
  it('treats extra cash as change, not negative invoice balance', () => {
    const result = applyPosTenders(315, [{ mode: 'cash', amount: 500 }]);
    expect(result.paidAmount).toBe(315);
    expect(result.balanceAmount).toBe(0);
    expect(result.cashTendered).toBe(500);
    expect(result.changeGiven).toBe(185);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].amount).toBe(315);
  });

  it('applies non-cash first then caps cash at remainder', () => {
    const result = applyPosTenders(315, [
      { mode: 'upi', amount: 100 },
      { mode: 'cash', amount: 500 },
    ]);
    expect(result.paidAmount).toBe(315);
    expect(result.balanceAmount).toBe(0);
    expect(result.changeGiven).toBe(285);
    const cash = result.payments.find((p) => p.mode === 'cash');
    expect(cash?.amount).toBe(215);
  });
});
