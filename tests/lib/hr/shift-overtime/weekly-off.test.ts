import { isWeeklyOffDate } from '@/lib/hr/shift-overtime/weekly-off';
import { parseWeeklyOffPolicy } from '@/lib/hr/shift-overtime/types';

describe('weekly off', () => {
  it('detects Sunday as weekly off', () => {
    const policy = parseWeeklyOffPolicy({ fixed_days: [0], nth_rules: [] });
    expect(isWeeklyOffDate('2025-06-01', policy)).toBe(true); // Sunday
    expect(isWeeklyOffDate('2025-06-02', policy)).toBe(false); // Monday
  });

  it('detects 2nd Saturday', () => {
    const policy = parseWeeklyOffPolicy({ fixed_days: [], nth_rules: [{ week: 2, weekday: 6 }] });
    expect(isWeeklyOffDate('2025-06-14', policy)).toBe(true); // 2nd Sat Jun 2025
    expect(isWeeklyOffDate('2025-06-07', policy)).toBe(false); // 1st Sat
  });
});
