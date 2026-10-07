import { computeTdsAmount } from '@/lib/partners/payouts';

describe('computeTdsAmount', () => {
  it('returns 0 when TDS disabled', () => {
    expect(
      computeTdsAmount({
        gross: 10000,
        tdsEnabled: false,
        tdsRatePercent: 2,
        hasPan: true,
      }),
    ).toBe(0);
  });

  it('applies configured rate with PAN', () => {
    expect(
      computeTdsAmount({
        gross: 10000,
        tdsEnabled: true,
        tdsRatePercent: 2,
        hasPan: true,
      }),
    ).toBe(200);
  });

  it('applies higher rate without PAN', () => {
    expect(
      computeTdsAmount({
        gross: 10000,
        tdsEnabled: true,
        tdsRatePercent: 2,
        hasPan: false,
      }),
    ).toBe(2000);
  });
});
