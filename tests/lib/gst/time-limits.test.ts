import {
  fyEndYear,
  isCreditNoteTaxReductionTimeBarred,
  isItcTimeBarred,
  thirtyNovAfterFy,
  todayIst,
} from '@/lib/gst/time-limits';

describe('FY boundaries', () => {
  it('April starts a new FY, March closes it', () => {
    expect(fyEndYear('2024-04-01')).toBe(2025);
    expect(fyEndYear('2025-03-31')).toBe(2025);
    expect(fyEndYear(new Date(2025, 2, 31))).toBe(2025);
  });
  it('deadline is 30 Nov after FY end', () => {
    expect(thirtyNovAfterFy('2024-06-15')).toBe('2025-11-30');
    expect(thirtyNovAfterFy('2025-03-31')).toBe('2025-11-30');
    expect(thirtyNovAfterFy('2025-04-01')).toBe('2026-11-30');
  });
});

describe('s.34(2) credit note — Run 11 L7', () => {
  it('FY 2024-25 invoice: CN on 30 Nov 2025 allowed, 1 Dec 2025 barred', () => {
    expect(isCreditNoteTaxReductionTimeBarred('2024-10-10', '2025-11-30')).toBe(false);
    expect(isCreditNoteTaxReductionTimeBarred('2024-10-10', '2025-12-01')).toBe(true);
  });
  it('same-FY credit note is never barred', () => {
    expect(isCreditNoteTaxReductionTimeBarred('2026-04-01', '2027-03-31')).toBe(false);
  });
});

describe('s.16(4) ITC — Run 11 L8', () => {
  it('FY 2024-25 bill claimed after 30 Nov 2025 is time-barred', () => {
    expect(isItcTimeBarred('2025-03-20', '2025-11-30')).toBe(false);
    expect(isItcTimeBarred('2025-03-20', '2025-12-01')).toBe(true);
  });
  it('current-FY bill is not barred', () => {
    expect(isItcTimeBarred('2026-09-01', '2026-09-28')).toBe(false);
  });
});

describe('todayIst', () => {
  it('rolls over at IST midnight, not UTC', () => {
    expect(todayIst(new Date('2026-09-27T18:31:00Z'))).toBe('2026-09-28');
    expect(todayIst(new Date('2026-09-27T18:29:00Z'))).toBe('2026-09-27');
  });
});
