import { collectReceivableAccountIds } from '@/lib/accounting/receivable-accounts';

const acc = (id: string, code: string, parent: string | null = null) => ({
  id,
  account_code: code,
  parent_account_id: parent,
});

describe('collectReceivableAccountIds', () => {
  test('control account, descendants at any depth, and legacy 1103-prefixed codes', () => {
    const ids = collectReceivableAccountIds(
      [
        acc('ar', '1103'),
        acc('dom', 'DOM', 'ar'),
        acc('north', 'N1', 'dom'),
        acc('legacy', '110301'),
        acc('cash', '1101'),
        acc('tds', '1116'),
      ],
      'ar',
    );
    expect(new Set(ids)).toEqual(new Set(['ar', 'dom', 'north', 'legacy']));
  });

  test('a mapped control account that is not 1103 still anchors the set', () => {
    const ids = collectReceivableAccountIds([acc('m', '1190'), acc('kid', 'K', 'm'), acc('old', '1103')], 'm');
    expect(new Set(ids)).toEqual(new Set(['m', 'kid', 'old']));
  });

  test('accounts under 1103 stay in the set when another account is mapped as the control account', () => {
    const ids = collectReceivableAccountIds(
      [acc('x', '1190'), acc('ar', '1103'), acc('dom', 'D1', 'ar'), acc('north', 'N1', 'dom'), acc('cash', '1101')],
      'x',
    );
    expect(new Set(ids)).toEqual(new Set(['x', 'ar', 'dom', 'north']));
  });

  test('a loop in parent links does not hang', () => {
    const ids = collectReceivableAccountIds([acc('ar', '1103', 'x'), acc('x', 'X', 'ar')], 'ar');
    expect(new Set(ids)).toEqual(new Set(['ar', 'x']));
  });
});
