import { replayItem, type Movement } from '@/lib/inventory/fifo-engine';

const insertVoucherLines = jest.fn();
let movementsByItem = new Map<string, Movement[]>();

jest.mock('@/lib/accounting/voucher-posting', () => ({
  ...jest.requireActual('@/lib/accounting/voucher-posting'),
  insertVoucherLines: (...args: unknown[]) => insertVoucherLines(...args),
  accountIdByCode: jest.fn(async () => 'acc-loss'),
}));

jest.mock('@/lib/inventory/fifo-costing', () => ({
  getValuationMethod: jest.fn(async () => 'fifo'),
  lockCostItems: jest.fn(async () => undefined),
  replayCostItems: jest.fn(async (_c: unknown, _b: string, ids: string[]) => {
    const movements = new Map<string, Movement[]>();
    const replays = new Map();
    for (const id of ids) {
      const list = movementsByItem.get(id) ?? [];
      movements.set(id, list);
      replays.set(id, replayItem(list, 0));
    }
    return { movements, replays, fallback: new Map(), names: new Map() };
  }),
}));

import { recostAfterStockChange, recostItems } from '@/lib/inventory/fifo-recost';

const BIZ = '00000000-0000-0000-0000-000000000001';
let seq = 0;
const mv = (m: Partial<Movement> & Pick<Movement, 'kind' | 'docId' | 'qty'>): Movement => {
  seq += 1;
  return { key: `${m.kind}:${m.docId}`, date: '2026-10-01', seq: String(seq).padStart(4, '0'), ...m } as Movement;
};

interface Posted { voucher_type: string; voucher_id: string; net_out: number }

function fakeClient(opts: { posted: Posted[]; lockedDates?: string[]; recostFrom?: string | null | 'missing' }) {
  const queries: string[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    queries.push(sql);
    if (sql.includes('net_out')) {
      return {
        rows: opts.posted.map((p) => ({ ...p, net_out: String(p.net_out), branch_id: null, entry_date: '2026-10-01' })),
      };
    }
    if (sql.includes("account_code IN ('1104', '5104')")) {
      return { rows: [{ account_code: '1104', id: 'acc-1104' }, { account_code: '5104', id: 'acc-5104' }] };
    }
    if (sql.includes('is_period_locked')) {
      return { rows: [{ locked: (opts.lockedDates ?? []).includes(String(params[2])) }] };
    }
    if (sql.includes('fifo_recost_from')) {
      if (opts.recostFrom === 'missing') return { rows: [{ present: false, d: null }] };
      return { rows: [{ present: true, d: opts.recostFrom ?? null }] };
    }
    return { rows: [] };
  });
  return { client: { query } as any, queries };
}

describe('FIFO recost', () => {
  beforeEach(() => {
    seq = 0;
    insertVoucherLines.mockReset();
    movementsByItem = new Map([
      [
        'item-a',
        [
          mv({ kind: 'purchase', docId: 'p1', qty: 10, unitCost: 100, date: '2026-09-01' }),
          mv({ kind: 'purchase', docId: 'p2', qty: 10, unitCost: 150, date: '2026-09-02' }),
          mv({ kind: 'invoice', docId: 'inv4', docNumber: 'INV-4', qty: 12, date: '2026-09-10' }),
          mv({ kind: 'credit_note', docId: 'cn1', docNumber: 'CN-1', qty: 2, date: '2026-09-12', linkedDocId: 'inv4' }),
        ],
      ],
    ]);
  });

  it('posts Dr COGS / Cr Inventory when the invoice was under-costed', async () => {
    const { client } = fakeClient({
      posted: [
        { voucher_type: 'invoice', voucher_id: 'inv4', net_out: 1500 },
        { voucher_type: 'credit_note', voucher_id: 'cn1', net_out: -216.67 },
      ],
    });
    // Posted at average 125 × 12 = 1500; FIFO says 10 × 100 + 2 × 150 = 1300.
    const report = await recostItems(client, BIZ, ['item-a']);
    const inv = report.changed.find((c) => c.voucherId === 'inv4')!;
    expect(inv).toMatchObject({ posted: 1500, expected: 1300, delta: -200 });
    const invCall = insertVoucherLines.mock.calls.find((c) => c[1].voucherId === 'inv4')![1];
    expect(invCall.voucherType).toBe('invoice');
    expect(invCall.entryDate).toBe('2026-09-10');
    expect(invCall.lines).toEqual([
      expect.objectContaining({ accountId: 'acc-1104', debit: 200, credit: 0 }),
      expect.objectContaining({ accountId: 'acc-5104', debit: 0, credit: 200 }),
    ]);
  });

  it('credit note comes back at the linked invoice unit cost (Dr Inventory when posted too low)', async () => {
    const { client } = fakeClient({
      posted: [
        { voucher_type: 'invoice', voucher_id: 'inv4', net_out: 1300 },
        { voucher_type: 'credit_note', voucher_id: 'cn1', net_out: -200 },
      ],
    });
    const report = await recostItems(client, BIZ, ['item-a']);
    expect(report.changed.map((c) => c.voucherId)).toEqual(['cn1']);
    // 1300 / 12 × 2 = 216.67
    expect(report.changed[0]).toMatchObject({ posted: 200, expected: 216.67, delta: 16.67 });
    expect(insertVoucherLines.mock.calls[0][1].lines).toEqual([
      expect.objectContaining({ accountId: 'acc-1104', debit: 16.67 }),
      expect.objectContaining({ accountId: 'acc-5104', credit: 16.67 }),
    ]);
  });

  it('leaves vouchers in a locked period alone', async () => {
    const { client } = fakeClient({
      posted: [
        { voucher_type: 'invoice', voucher_id: 'inv4', net_out: 1500 },
        { voucher_type: 'credit_note', voucher_id: 'cn1', net_out: -216.67 },
      ],
      lockedDates: ['2026-09-10'],
    });
    const report = await recostItems(client, BIZ, ['item-a']);
    expect(report.skippedLocked.map((c) => c.voucherId)).toEqual(['inv4']);
    expect(report.changed).toHaveLength(0);
    expect(insertVoucherLines).not.toHaveBeenCalled();
  });

  it('does not touch vouchers dated before the cut-over', async () => {
    const { client } = fakeClient({
      posted: [
        { voucher_type: 'invoice', voucher_id: 'inv4', net_out: 1500 },
        { voucher_type: 'credit_note', voucher_id: 'cn1', net_out: -200 },
      ],
    });
    const report = await recostItems(client, BIZ, ['item-a'], { fromDate: '2026-09-11' });
    expect(report.changed.map((c) => c.voucherId)).toEqual(['cn1']);
    expect(insertVoucherLines.mock.calls.map((c) => c[1].voucherId)).toEqual(['cn1']);
  });

  it('dry run reports corrections without posting', async () => {
    const { client } = fakeClient({
      posted: [
        { voucher_type: 'invoice', voucher_id: 'inv4', net_out: 1500 },
        { voucher_type: 'credit_note', voucher_id: 'cn1', net_out: -200 },
      ],
    });
    const report = await recostItems(client, BIZ, ['item-a'], { dryRun: true });
    expect(report.changed).toHaveLength(2);
    expect(report.dryRun).toBe(true);
    expect(insertVoucherLines).not.toHaveBeenCalled();
  });

  it('skips automatic recost when migration 333 has not added the cut-over column', async () => {
    const { client, queries } = fakeClient({ posted: [], recostFrom: 'missing' });
    const result = await recostAfterStockChange(client, BIZ, ['item-a']);
    expect(result).toBeNull();
    expect(queries.some((q) => q.includes('net_out'))).toBe(false);
    expect(queries).toContain('RELEASE SAVEPOINT fifo_recost');
  });

  it('automatic recost respects the cut-over date', async () => {
    const { client } = fakeClient({
      posted: [
        { voucher_type: 'invoice', voucher_id: 'inv4', net_out: 1500 },
        { voucher_type: 'credit_note', voucher_id: 'cn1', net_out: -200 },
      ],
      recostFrom: '2026-09-11',
    });
    const result = await recostAfterStockChange(client, BIZ, ['item-a']);
    expect(result?.changed.map((c) => c.voucherId)).toEqual(['cn1']);
  });
});
