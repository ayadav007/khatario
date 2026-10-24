import { parseRecentTxFilter, recentTransactionLikePattern, recentTransactionsSql } from '@/lib/dashboard/recent-transactions';

describe('recentTransactionsSql', () => {
  it('includes every transaction type when the filter is all', () => {
    const sql = recentTransactionsSql({
      branchParam: null,
      searchParam: null,
      cursorAtParam: null,
      cursorIdParam: null,
      limitParam: 2,
      filter: 'all',
    });
    expect(sql).toContain("'invoice'");
    expect(sql).toContain("'purchase'");
    expect(sql).toContain("'payment_in'");
    expect(sql).toContain("'credit_note'");
    expect(sql).toContain("'purchase_return'");
    expect(sql).toContain("'expense'");
  });

  it('limits a purchase filter to purchase bills', () => {
    const sql = recentTransactionsSql({
      branchParam: 2,
      searchParam: 3,
      cursorAtParam: 4,
      cursorIdParam: 5,
      limitParam: 6,
      filter: 'purchase',
    });
    expect(sql).toContain('FROM purchases');
    expect(sql).toContain('p.payment_status');
    expect(sql).toContain('AS sort_at');
    expect(sql).not.toContain('FROM invoices');
    expect(sql).toContain('ANY($2::uuid[])');
    expect(sql).toContain('ILIKE $3');
    expect(sql).toContain('LIMIT $6');
  });

  it('keeps only payments that are not settled against an invoice or purchase', () => {
    const sql = recentTransactionsSql({
      branchParam: null,
      searchParam: null,
      cursorAtParam: null,
      cursorIdParam: null,
      limitParam: 2,
      filter: 'payment',
    });
    expect(sql).toContain("NOT IN ('invoice', 'purchase')");
    expect(sql).toContain('AS sort_at');
    expect(sql).not.toContain('FROM purchases');
  });
});

describe('recent transaction query helpers', () => {
  it('ignores an unknown filter and escapes search wildcards', () => {
    expect(parseRecentTxFilter('nope')).toBe('all');
    expect(parseRecentTxFilter('return')).toBe('return');
    expect(recentTransactionLikePattern('  10%_off  ')).toBe('%10\\%\\_off%');
    expect(recentTransactionLikePattern('   ')).toBeNull();
  });
});
