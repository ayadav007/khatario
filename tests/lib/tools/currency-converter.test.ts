import { RUPEES_PER_UNIT, exchangeRate, convertAmount } from '@/lib/tools/currency-converter';

describe('currency converter rate', () => {
  it('INR to USD gives dollars per rupee, not 83', () => {
    expect(exchangeRate('INR', 'USD')).toBeCloseTo(1 / RUPEES_PER_UNIT.USD, 8);
    expect(convertAmount(8300, 'INR', 'USD')).toBeCloseTo(100, 6);
  });

  it('USD to INR gives rupees per dollar', () => {
    expect(exchangeRate('USD', 'INR')).toBeCloseTo(RUPEES_PER_UNIT.USD, 8);
  });

  it('cross pair is (rupees per from) / (rupees per to)', () => {
    expect(exchangeRate('USD', 'EUR')).toBeCloseTo(RUPEES_PER_UNIT.USD / RUPEES_PER_UNIT.EUR, 8);
    expect(exchangeRate('GBP', 'JPY')).toBeCloseTo(RUPEES_PER_UNIT.GBP / RUPEES_PER_UNIT.JPY, 8);
  });

  it('same currency is 1', () => {
    expect(exchangeRate('EUR', 'EUR')).toBe(1);
  });
});
