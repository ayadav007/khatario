jest.mock('@/lib/db', () => ({ queryRows: jest.fn() }));

import * as db from '@/lib/db';
import { filingPeriodFromRange, generateReconciliationExcel } from '@/lib/export/gstr2b-reconciliation-export';

const queryRows = db.queryRows as jest.Mock;

describe('GSTR-2B reconciliation export', () => {
  beforeEach(() => {
    queryRows.mockReset();
    queryRows.mockResolvedValue([]);
  });

  it('reads the reconciliation period, not purchase tax columns', async () => {
    const buffer = await generateReconciliationExcel({
      business_id: 'biz-1',
      from_date: '2026-10-01',
      to_date: '2026-10-30',
      status: 'MISSING_IN_2B',
    });

    const sql = String(queryRows.mock.calls[0][0]);
    expect(sql).toContain('FROM gstr2b_reconciliation r');
    expect(sql).toContain('r.books_taxable_value');
    expect(sql).toContain('r.gstr2b_taxable_value');
    expect(sql).not.toContain('p.taxable_value');
    expect(sql).not.toContain('p.cgst_amount');
    expect(sql).not.toContain('gr.gstr2b_invoice_no');
    expect(queryRows.mock.calls[0][1]).toEqual(['biz-1', '2026-10', 'MISSING_IN_2B']);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('derives the filing period from the from-date the current page sends', () => {
    expect(filingPeriodFromRange('2026-10-01', '2026-10-30')).toBe('2026-10');
    expect(filingPeriodFromRange(undefined, undefined)).toBeNull();
  });
});
