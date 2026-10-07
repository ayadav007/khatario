import { billingStatusFromLines, isSalesOrderConvertibleStatus } from '@/lib/sales-orders/billing-status';

describe('sales order reservation backlog helpers', () => {
  test('partial convert status stays open until remaining is zero', () => {
    expect(billingStatusFromLines([{ qty: 10, fulfilled_qty: 4 }])).toBe('partially_fulfilled');
    expect(billingStatusFromLines([{ qty: 10, fulfilled_qty: 10 }])).toBe('fulfilled');
  });

  test('partial-open orders remain convertible', () => {
    expect(isSalesOrderConvertibleStatus('partially_fulfilled')).toBe(true);
    expect(isSalesOrderConvertibleStatus('fulfilled')).toBe(false);
  });
});
