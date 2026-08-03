import { buildEngagementPayload } from '@/lib/hr/engagement-audience';
import { applyProbationOnJoin } from '@/lib/hr/probation-auto-confirm';
import { parseHrEmployeeSettings, computeProbationEndDate } from '@/lib/hr/employee-settings';
import { parseHrExitSettings, resolveNoticePeriodDays } from '@/lib/hr/exit-settings';

jest.mock('@/lib/db', () => ({
  queryOne: jest.fn(),
  queryRows: jest.fn(),
}));

import { queryOne } from '@/lib/db';

describe('buildEngagementPayload', () => {
  it('includes department audience', () => {
    expect(
      buildEngagementPayload({ type: 'departments', departments: ['Sales'] }, '2026-12-31'),
    ).toEqual({
      audience: { type: 'departments', departments: ['Sales'] },
      expires_at: '2026-12-31',
    });
  });
});

describe('applyProbationOnJoin', () => {
  beforeEach(() => {
    jest.mocked(queryOne).mockReset();
  });

  it('sets in_probation when period configured', async () => {
    jest.mocked(queryOne)
      .mockResolvedValueOnce({
        hr_employee_settings: { probation_period_value: 3, probation_period_unit: 'months' },
      } as never)
      .mockResolvedValueOnce({} as never);

    await applyProbationOnJoin('biz', 'emp', '2026-01-01');
    expect(queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('probation_status'),
      expect.arrayContaining(['emp', '2026-04-01']),
    );
  });
});

describe('parseHrEmployeeSettings', () => {
  it('defaults missing fields', () => {
    const s = parseHrEmployeeSettings({});
    expect(s.employee_id_prefix).toBe('EMP');
    expect(s.probation_period_unit).toBe('months');
  });

  it('computes probation end from months', () => {
    const end = computeProbationEndDate(new Date('2026-01-15'), {
      ...parseHrEmployeeSettings({}),
      probation_period_value: 3,
      probation_period_unit: 'months',
    });
    expect(end?.toISOString().slice(0, 10)).toBe('2026-04-15');
  });
});

describe('parseHrExitSettings', () => {
  it('resolves seniority notice rules', () => {
    const settings = parseHrExitSettings({
      default_notice_period_days: 30,
      seniority_notice_rules: [{ min_years: 5, notice_period_days: 90 }],
    });
    expect(resolveNoticePeriodDays(settings, 6)).toBe(90);
    expect(resolveNoticePeriodDays(settings, 1)).toBe(30);
  });
});
