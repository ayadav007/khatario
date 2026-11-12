import { SYSTEM_PL_SECTIONS } from '@/lib/accounting/pl-sections';
import {
  effectiveSchedule3Placement,
  schedule3Amount,
  SYSTEM_SCHEDULE3_PLACEMENTS,
  type Schedule3AccountLike,
} from '@/lib/accounting/schedule3-lines';

function acc(code: string, type: string, extra: Partial<Schedule3AccountLike> = {}): Schedule3AccountLike {
  return {
    id: 'acc-' + code,
    account_code: code,
    account_type: type,
    is_system: Object.prototype.hasOwnProperty.call(SYSTEM_PL_SECTIONS, code),
    group_code: type === 'income' ? '4100' : '5200',
    parent_account_id: null,
    ...extra,
  };
}

const place = (a: Schedule3AccountLike, others: Schedule3AccountLike[] = []) =>
  effectiveSchedule3Placement(a, new Map([a, ...others].map((x) => [x.id, x])));

test('seeded codes use the fixed table', () => {
  expect(place(acc('4101', 'income'))).toBe('revenue_from_operations');
  expect(place(acc('4102', 'income'))).toBe('other_income');
  expect(place(acc('5212', 'expense'))).toBe('employee_benefits');
  expect(place(acc('5205', 'expense'))).toBe('finance_costs');
  expect(place(acc('5204', 'expense'))).toBe('depreciation_amortisation');
  expect(place(acc('5210', 'expense'))).toBe('current_tax');
  expect(place(acc('5211', 'expense'))).toBe('deferred_tax');
  expect(place(acc('5105', 'expense'))).toBe('purchases_stock_in_trade');
  expect(place(acc('5217', 'expense'))).toBe('other_expenses');
  expect(place(acc('5104', 'expense'))).toBe('stock_cost');
  expect(place(acc('4103', 'income'))).toBe('elimination');
});

test('every seeded P&L code has a placement', () => {
  for (const code of Object.keys(SYSTEM_PL_SECTIONS)) expect(SYSTEM_SCHEDULE3_PLACEMENTS[code]).toBeDefined();
});

test('user account with no parent takes the section default', () => {
  expect(place(acc('5901', 'expense', { is_system: false }))).toBe('other_expenses');
  expect(place(acc('5902', 'expense', { is_system: false, group_code: '5100' }))).toBe('other_expenses');
  expect(place(acc('4901', 'income', { is_system: false, group_code: '4200' }))).toBe('other_income');
  expect(place(acc('4902', 'income', { is_system: false, pl_section: 'operating_expense' }))).toBe('other_income');
  expect(place(acc('5903', 'expense', { is_system: false, pl_section: 'operating_income' }))).toBe(
    'revenue_from_operations'
  );
});

test('sub-account follows its nearest placed parent', () => {
  const parent = acc('5205', 'expense');
  const mid = acc('5910', 'expense', { is_system: false, parent_account_id: parent.id });
  const leaf = acc('5911', 'expense', { is_system: false, parent_account_id: mid.id });
  expect(place(leaf, [mid, parent])).toBe('finance_costs');
});

test('stored line wins, unless it is not assignable or the code is locked', () => {
  expect(place(acc('5217', 'expense', { schedule3_line: 'finance_costs' }))).toBe('finance_costs');
  expect(place(acc('5901', 'expense', { is_system: false, schedule3_line: 'changes_in_inventories' }))).toBe(
    'other_expenses'
  );
  expect(place(acc('5901', 'expense', { is_system: false, schedule3_line: 'nonsense' }))).toBe('other_expenses');
  expect(place(acc('5104', 'expense', { schedule3_line: 'other_expenses' }))).toBe('stock_cost');
});

test('a parent loop ends at the section default', () => {
  const a = acc('5920', 'expense', { is_system: false, parent_account_id: 'acc-5921' });
  const b = acc('5921', 'expense', { is_system: false, parent_account_id: 'acc-5920' });
  expect(place(a, [b])).toBe('other_expenses');
});

test('amount sign', () => {
  expect(schedule3Amount('other_income', 10, 100)).toBe(90);
  expect(schedule3Amount('other_expenses', 100, 10)).toBe(90);
});
