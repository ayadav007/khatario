jest.mock('@/lib/db', () => ({ queryRows: jest.fn() }));

import {
  ARCHIVE_MISSING_MESSAGE,
  BILLING_TRANSACTION_COLUMNS,
  archiveBusinessBillingTransactions,
} from '@/lib/platform-billing-archive';

describe('billing archive column list', () => {
  it('has no duplicates', () => {
    expect(new Set(BILLING_TRANSACTION_COLUMNS).size).toBe(BILLING_TRANSACTION_COLUMNS.length);
  });
  it('includes the key payment columns', () => {
    for (const c of ['id', 'business_id', 'status', 'total_amount', 'payment_reference']) {
      expect(BILLING_TRANSACTION_COLUMNS).toContain(c);
    }
  });
});

describe('archiveBusinessBillingTransactions', () => {
  it('refuses with the migration message and runs no insert when the archive table is missing', async () => {
    const query = jest.fn(async () => ({ rows: [{ t: null }] }));
    await expect(
      archiveBusinessBillingTransactions({ query } as never, 'b1', 'x', { archiveTable: 'no_such_table_xyz' }),
    ).rejects.toThrow(ARCHIVE_MISSING_MESSAGE);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('to_regclass'), ['public.no_such_table_xyz']);
  });
  it('uses the same explicit columns in both halves of the INSERT ... SELECT', async () => {
    const query = jest.fn(async (sql: string) => (sql.includes('to_regclass') ? { rows: [{ t: 'x' }] } : { rows: [], rowCount: 2 }));
    expect(await archiveBusinessBillingTransactions({ query } as never, 'b1', 'r')).toBe(2);
    const sql = (query.mock.calls[1] as unknown as [string])[0];
    expect(sql).not.toMatch(/\*/);
    for (const c of BILLING_TRANSACTION_COLUMNS) {
      expect(sql).toContain(`bt.${c}`);
    }
  });
});
