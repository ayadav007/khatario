import { gstRatesForCode } from '@/lib/gst/rate-schedule';

describe('gstRatesForCode', () => {
  it('rates gears and gearing at 18 percent', () => {
    const rates = gstRatesForCode('84834000');
    expect(rates.map((rate) => rate.gst_rate)).toEqual([18]);
  });

  it('keeps both heading 8714 rates', () => {
    const rates = gstRatesForCode('87141090').map((rate) => rate.gst_rate).sort((a, b) => a - b);
    expect(rates).toEqual([5, 18]);
  });

  it('does not rate an excluded code or a service code', () => {
    expect(gstRatesForCode('05079010')).toEqual([]);
    expect(gstRatesForCode('995411')).toEqual([]);
  });
});
