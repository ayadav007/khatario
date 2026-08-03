import {
  fetchPortalLeaveBalances,
  type PortalLeaveBalanceCard,
} from '@/lib/employee-portal/portal-dashboard';

jest.mock('@/lib/db', () => ({
  queryRows: jest.fn(),
  queryOne: jest.fn(),
}));

import { queryRows } from '@/lib/db';

describe('fetchPortalLeaveBalances', () => {
  beforeEach(() => {
    jest.mocked(queryRows).mockReset();
  });

  it('maps accrued from opening, earned, and carry forward', async () => {
    jest.mocked(queryRows).mockResolvedValue([
      {
        leave_type_id: 't1',
        leave_name: 'Casual Leave',
        leave_code: 'CL',
        current_balance: '5',
        used_days: '3',
        earned_days: '6',
        opening_balance: '1',
        carry_forward_days: '1',
        max_days_per_year: 10,
      },
    ] as never);

    const result = await fetchPortalLeaveBalances('biz', 'emp', 2026);
    expect(result[0]).toEqual({
      leave_type_id: 't1',
      leave_name: 'Casual Leave',
      leave_code: 'CL',
      available: 5,
      consumed: 3,
      accrued_so_far: 8,
      annual_quota: 10,
    } satisfies PortalLeaveBalanceCard);
  });
});
