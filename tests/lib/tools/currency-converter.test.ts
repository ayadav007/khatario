import { RUPEES_PER_UNIT, exchangeRate, convertAmount } from '@/lib/tools/currency-converter';

describe('currency converter rate', () => {
  it('INR to USD gives dollars per rupee, not rupees per dollar', () => {
    expect(exchangeRate('INR', 'USD')).toBeCloseTo(1 / RUPEES_PER_UNIT.USD, 8);
    expect(convertAmount(RUPEES_PER_UNIT.USD * 100, 'INR', 'USD')).toBeCloseTo(100, 6);
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

describe('currency converter reference rates', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@/lib/tools/currency-converter');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');

  it('states the reference rate date as YYYY-MM-DD', () => {
    expect(mod.CURRENCY_RATES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('names an official RBI or FBIL source', () => {
    const host = new URL(mod.CURRENCY_RATES_SOURCE).hostname;
    expect(host).toMatch(/(^|\.)(rbi\.org\.in|fbil\.org\.in)$/);
  });

  it('every rate is a positive finite number', () => {
    for (const rate of Object.values(RUPEES_PER_UNIT)) {
      expect(Number.isFinite(rate)).toBe(true);
      expect(rate).toBeGreaterThan(0);
    }
  });

  it('the component no longer claims a refresh or a live update time', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/tools/CurrencyConverterTool.tsx'), 'utf8');
    expect(src).not.toMatch(/Refresh/);
    expect(src).not.toMatch(/Last updated/);
  });
});

describe('formatRatesDate', () => {
  it('writes the date as D Month YYYY', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { formatRatesDate } = require('@/lib/tools/currency-converter');
    expect(formatRatesDate('2026-11-12')).toBe('12 November 2026');
    expect(formatRatesDate('2026-01-05')).toBe('5 January 2026');
  });
});
