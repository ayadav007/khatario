import {
  bookDepreciation,
  computeItBlocks,
  daysInclusive,
  fyStartYear,
  isHalfRateAddition,
  parseFyLabel,
  wdvRateFromLife,
} from '@/lib/accounting/it-depreciation';

describe('date helpers', () => {
  it('counts inclusive days and FY start years', () => {
    expect(daysInclusive('2026-04-01', '2027-03-31')).toBe(365);
    expect(daysInclusive('2026-05-02', '2026-05-01')).toBe(0);
    expect(fyStartYear('2027-03-31')).toBe(2026);
    expect(fyStartYear('2026-04-01')).toBe(2026);
    expect(parseFyLabel('2026-27')).toBe(2026);
    expect(parseFyLabel('2026-28')).toBeNull();
  });
});

describe('isHalfRateAddition', () => {
  it('uses the 180-day threshold ending 31 March', () => {
    // 3-Oct to 31-Mar = 180 days: full rate; 4-Oct = 179 days: half rate.
    expect(isHalfRateAddition('2026-10-03')).toBe(false);
    expect(isHalfRateAddition('2026-10-04')).toBe(true);
    expect(isHalfRateAddition('2026-04-15')).toBe(false);
  });
});

describe('bookDepreciation (Schedule II)', () => {
  it('pro-rates SLM by days from put-to-use date', () => {
    const r = bookDepreciation({
      method: 'SLM',
      cost: 100000,
      residual: 5000,
      usefulLifeYears: 5,
      openingBookValue: 100000,
      periodStart: '2026-04-01',
      periodEnd: '2027-03-31',
      putToUseDate: '2026-10-01',
    });
    expect(r.annual).toBe(19000);
    expect(r.daysUsed).toBe(182);
    expect(r.amount).toBe(9473.97);
  });

  it('derives the WDV rate from useful life and stops at residual value', () => {
    expect(wdvRateFromLife(5)).toBe(45.07);
    const r = bookDepreciation({
      method: 'WDV',
      cost: 100000,
      residual: 5000,
      usefulLifeYears: 5,
      openingBookValue: 6000,
      periodStart: '2030-04-01',
      periodEnd: '2031-03-31',
      putToUseDate: '2026-04-01',
    });
    expect(r.amount).toBe(1000);
  });
});

describe('computeItBlocks', () => {
  it('allows half rate on additions used < 180 days and carries WDV forward', () => {
    const rows = computeItBlocks(
      [
        { block: 'plant_general', cost: 100000, putToUseDate: '2025-05-01' },
        { block: 'plant_general', cost: 40000, putToUseDate: '2025-12-01' },
      ],
      '2026-27'
    );
    expect(rows).toHaveLength(1);
    // FY 2025-26: 100000*15% + 40000*7.5% = 18000; closing 122000.
    // FY 2026-27: 122000*15% = 18300; closing 103700.
    expect(rows[0].openingWdv).toBe(122000);
    expect(rows[0].depreciation).toBe(18300);
    expect(rows[0].closingWdv).toBe(103700);
  });

  it('reduces sale proceeds from the block and reports s.50 gain when the block goes negative', () => {
    const rows = computeItBlocks(
      [
        { block: 'computers', cost: 50000, putToUseDate: '2025-04-10' },
        { block: 'computers', cost: 10000, putToUseDate: '2025-04-10', disposalDate: '2026-06-01', disposalProceeds: 45000 },
      ],
      '2026-27'
    );
    // FY 2025-26: 60000*40% = 24000; closing 36000. FY 2026-27: 36000 - 45000 < 0: STCG 9000.
    expect(rows[0].shortTermCapitalGain).toBe(9000);
    expect(rows[0].depreciation).toBe(0);
    expect(rows[0].closingWdv).toBe(0);
  });

  it('reports a short-term capital loss when the block ceases with WDV left', () => {
    const rows = computeItBlocks(
      [{ block: 'furniture', cost: 20000, putToUseDate: '2025-04-01', disposalDate: '2026-05-01', disposalProceeds: 5000 }],
      '2026-27'
    );
    // FY 2025-26: dep 2000, closing 18000. FY 2026-27: block ceases, loss 13000.
    expect(rows[0].shortTermCapitalGain).toBe(-13000);
    expect(rows[0].closingWdv).toBe(0);
  });
});
