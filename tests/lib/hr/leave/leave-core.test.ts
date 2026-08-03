import {
  getLeaveYear,
  getLeaveYearDateRange,
  roundLeaveDays,
  parseLeaveApprovalChain,
} from '@/lib/hr/leave/types';
import { prorateAnnualQuota } from '@/lib/hr/leave/leave-days';
import { parseLeaveBalanceCsv } from '@/lib/hr/leave/leave-bulk-import';

describe('getLeaveYear', () => {
  it('uses calendar year when start month is January', () => {
    expect(getLeaveYear('2025-06-15', 1)).toBe(2025);
  });

  it('uses Apr–Mar year when start month is April', () => {
    expect(getLeaveYear('2025-03-31', 4)).toBe(2024);
    expect(getLeaveYear('2025-04-01', 4)).toBe(2025);
  });
});

describe('getLeaveYearDateRange', () => {
  it('returns Jan–Dec for calendar year', () => {
    expect(getLeaveYearDateRange(2025, 1)).toEqual({
      start: '2025-01-01',
      end: '2025-12-31',
    });
  });

  it('returns Apr–Mar for fiscal leave year', () => {
    expect(getLeaveYearDateRange(2025, 4)).toEqual({
      start: '2025-04-01',
      end: '2026-03-31',
    });
  });
});

describe('roundLeaveDays', () => {
  it('rounds to half day', () => {
    expect(roundLeaveDays(1.3, 'half_day')).toBe(1.5);
    expect(roundLeaveDays(1.2, 'half_day')).toBe(1);
  });

  it('rounds to full day', () => {
    expect(roundLeaveDays(1.4, 'full_day')).toBe(1);
    expect(roundLeaveDays(1.6, 'full_day')).toBe(2);
  });
});

describe('prorateAnnualQuota', () => {
  it('returns full quota when joining at year start', () => {
    const quota = prorateAnnualQuota(12, '2025-01-01', 1, new Date('2025-06-01'));
    expect(quota).toBe(12);
  });

  it('returns partial quota for mid-year join', () => {
    const quota = prorateAnnualQuota(12, '2025-07-01', 1, new Date('2025-12-01'));
    expect(quota).toBeGreaterThan(0);
    expect(quota).toBeLessThan(12);
  });
});

describe('parseLeaveApprovalChain', () => {
  it('normalizes levels and filters invalid roles', () => {
    const chain = parseLeaveApprovalChain([
      { level: 2, role_type: 'hr', label: 'HR' },
      { level: 1, role_type: 'invalid', label: 'Bad' },
    ]);
    expect(chain).toHaveLength(2);
    expect(chain[0].level).toBe(1);
    expect(chain[0].role_type).toBe('reporting_manager');
    expect(chain[1].role_type).toBe('hr');
  });
});

describe('parseLeaveBalanceCsv', () => {
  it('parses header and rows', () => {
    const csv = `employee_code,leave_code,opening_balance,earned_days
E1,CL,2,10`;
    const rows = parseLeaveBalanceCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      employee_code: 'E1',
      leave_code: 'CL',
      opening_balance: 2,
      earned_days: 10,
    });
  });

  it('returns empty for missing headers', () => {
    expect(parseLeaveBalanceCsv('foo,bar\n1,2')).toEqual([]);
  });
});
