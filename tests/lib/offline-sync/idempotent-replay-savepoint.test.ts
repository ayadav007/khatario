/**
 * A replay executor that writes rows and then returns ok:false must not have
 * those writes committed (sales.finalize could otherwise leave a final invoice
 * with stock moved and no ledger).
 */
const queries: string[] = [];
const client = {
  query: jest.fn(async (sql: string) => {
    queries.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
    return { rows: [] };
  }),
  release: jest.fn(),
};

jest.mock('@/lib/db', () => ({ getPool: () => ({ connect: async () => client }) }));
jest.mock('@/lib/offline-sync/replay-log-repository', () => ({
  insertReplayLogPending: jest.fn(async () => ({ id: 'r1', request_hash: 'h', status: 'pending', replay_attempts: 0 })),
  lockReplayLogRow: jest.fn(async () => ({ id: 'r1', request_hash: 'h', status: 'processing', replay_attempts: 0 })),
  findReplayLog: jest.fn(),
  markReplayCompleted: jest.fn(async () => undefined),
  markReplayFailed: jest.fn(async () => undefined),
  markReplayManualReview: jest.fn(async () => undefined),
  markReplayProcessing: jest.fn(async () => undefined),
  incrementDuplicatePrevented: jest.fn(async () => undefined),
  canRetryFailed: jest.fn(() => true),
  isProcessingStale: jest.fn(() => true),
}));
jest.mock('@/lib/offline-sync/types', () => ({ hashReplayPayload: () => 'h', POISON_QUEUE_ATTEMPTS: 5 }));

import { withIdempotentReplay } from '@/lib/offline-sync/with-idempotent-replay';

const ctx = { businessId: 'b', userId: 'u', idempotencyKey: 'k', actionType: 'sales.finalize', requestPayload: {} };

describe('withIdempotentReplay savepoint', () => {
  beforeEach(() => {
    queries.length = 0;
  });

  it('rolls back executor writes when it returns ok:false, then commits only the failure record', async () => {
    const res = await withIdempotentReplay(ctx, async (c) => {
      await c.query('INSERT INTO invoices (id) VALUES (1)');
      return { ok: false, kind: 'failed', message: 'Sales account (4101) not found', permanent: false };
    });
    expect(res.success).toBe(false);
    const iInsert = queries.findIndex((q) => q.startsWith('INSERT INTO invoices'));
    const iRollback = queries.indexOf('ROLLBACK TO SAVEPOINT replay_exec');
    const iCommit = queries.lastIndexOf('COMMIT');
    expect(queries).toContain('SAVEPOINT replay_exec');
    expect(iRollback).toBeGreaterThan(iInsert);
    expect(iCommit).toBeGreaterThan(iRollback);
  });

  it('releases the savepoint and commits on success', async () => {
    const res = await withIdempotentReplay(ctx, async () => ({ ok: true, response: {} }));
    expect(res.success).toBe(true);
    expect(queries).toContain('RELEASE SAVEPOINT replay_exec');
    expect(queries).not.toContain('ROLLBACK TO SAVEPOINT replay_exec');
  });
});
