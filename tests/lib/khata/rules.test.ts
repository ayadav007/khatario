import { decideKhataOrder, type KhataCheckInput } from '@/lib/khata/rules';

const base: KhataCheckInput = {
  balance: 0,
  pendingOrders: 0,
  orderTotal: 500,
  creditLimit: 0,
  overdueAmount: 0,
  overLimitRule: 'approval',
  overdueRule: 'approval',
};

describe('khata order rules', () => {
  test('no limit and nothing overdue: allowed', () => {
    expect(decideKhataOrder(base)).toMatchObject({ outcome: 'allow', overLimit: false, overdue: false, reason: null });
  });

  test('under the limit, counting orders not yet billed', () => {
    const d = decideKhataOrder({ ...base, creditLimit: 2000, balance: 1000, pendingOrders: 500 });
    expect(d).toMatchObject({ outcome: 'allow', projected: 2000 });
  });

  test('over the limit uses the over-limit rule', () => {
    const d = decideKhataOrder({ ...base, creditLimit: 2000, balance: 1800, overLimitRule: 'block' });
    expect(d).toMatchObject({ outcome: 'block', overLimit: true, overBy: 300, reason: 'over_limit' });
    expect(decideKhataOrder({ ...base, creditLimit: 2000, balance: 1800, overLimitRule: 'warn' }).outcome).toBe('warn');
  });

  test('an advance (negative balance) does not count against the limit', () => {
    expect(decideKhataOrder({ ...base, creditLimit: 400, balance: -1000 }).outcome).toBe('approval');
    expect(decideKhataOrder({ ...base, creditLimit: 500, balance: -1000 }).outcome).toBe('allow');
  });

  test('overdue bills use the overdue rule', () => {
    const d = decideKhataOrder({ ...base, overdueAmount: 300, overdueRule: 'warn' });
    expect(d).toMatchObject({ outcome: 'warn', overdue: true, reason: 'overdue' });
  });

  test('both failing: the stricter rule wins', () => {
    const both = { ...base, creditLimit: 100, overdueAmount: 300 };
    expect(decideKhataOrder({ ...both, overLimitRule: 'warn', overdueRule: 'approval' }).outcome).toBe('approval');
    expect(decideKhataOrder({ ...both, overLimitRule: 'block', overdueRule: 'warn' }).outcome).toBe('block');
    expect(decideKhataOrder({ ...both, overLimitRule: 'approval', overdueRule: 'approval' }).reason).toBe('over_limit_overdue');
  });
});
