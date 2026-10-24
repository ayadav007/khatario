import {
  billingStatusFromLines,
  isSalesOrderConvertibleStatus,
  lineRemainingQty,
} from '@/lib/sales-orders/billing-status';

describe('sales order billing status', () => {
  test('remaining qty is ordered minus fulfilled', () => {
    expect(lineRemainingQty({ qty: 10, fulfilled_qty: 3 })).toBe(7);
    expect(lineRemainingQty({ qty: 5, fulfilled_qty: 5 })).toBe(0);
    expect(lineRemainingQty({ qty: 2, fulfilled_qty: 0 })).toBe(2);
  });

  test('open when nothing invoiced', () => {
    expect(billingStatusFromLines([{ qty: 10, fulfilled_qty: 0 }])).toBe('confirmed');
  });

  test('partial when some remaining', () => {
    expect(
      billingStatusFromLines([
        { qty: 10, fulfilled_qty: 4 },
        { qty: 2, fulfilled_qty: 2 },
      ]),
    ).toBe('partially_fulfilled');
  });

  test('completed when all lines fully invoiced', () => {
    expect(
      billingStatusFromLines([
        { qty: 10, fulfilled_qty: 10 },
        { qty: 2, fulfilled_qty: 2 },
      ]),
    ).toBe('fulfilled');
  });

  test('convertible statuses', () => {
    expect(isSalesOrderConvertibleStatus('confirmed')).toBe(true);
    expect(isSalesOrderConvertibleStatus('partially_fulfilled')).toBe(true);
    expect(isSalesOrderConvertibleStatus('draft')).toBe(true);
    expect(isSalesOrderConvertibleStatus('fulfilled')).toBe(false);
    expect(isSalesOrderConvertibleStatus('cancelled')).toBe(false);
  });
});
