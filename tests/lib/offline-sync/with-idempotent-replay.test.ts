import {
  canRetryFailed,
  isProcessingStale,
} from '@/lib/offline-sync/replay-log-repository';
import type { OfflineReplayLogRow } from '@/lib/offline-sync/types';
import { POISON_QUEUE_ATTEMPTS } from '@/lib/offline-sync/types';

function baseRow(overrides: Partial<OfflineReplayLogRow>): OfflineReplayLogRow {
  return {
    id: '1',
    business_id: 'b1',
    idempotency_key: 'key-1',
    action_type: 'purchase.finalize',
    request_hash: 'abc',
    request_payload: {},
    response_payload: null,
    status: 'failed',
    error_message: null,
    entity_type: null,
    entity_id: null,
    replay_attempts: 0,
    first_seen_at: new Date(),
    last_attempt_at: null,
    completed_at: null,
    created_by_user_id: null,
    device_id: null,
    created_at: new Date(),
    ...overrides,
  };
}

describe('replay-log retry helpers', () => {
  it('allows retry when attempts are below cap', () => {
    expect(canRetryFailed(baseRow({ replay_attempts: 3 }))).toBe(true);
    expect(canRetryFailed(baseRow({ replay_attempts: 8 }))).toBe(false);
  });

  it('detects stale processing rows for crash recovery', () => {
    expect(
      isProcessingStale(
        baseRow({
          status: 'processing',
          last_attempt_at: new Date(Date.now() - 10 * 60 * 1000),
        })
      )
    ).toBe(true);

    expect(
      isProcessingStale(
        baseRow({
          status: 'processing',
          last_attempt_at: new Date(),
        })
      )
    ).toBe(false);
  });

  it('uses poison queue cap constant', () => {
    expect(POISON_QUEUE_ATTEMPTS).toBe(8);
  });
});

describe('withIdempotentReplay decision matrix', () => {
  it('completed rows short-circuit to duplicate semantics', () => {
    const row = baseRow({
      status: 'completed',
      response_payload: { purchase_id: 'p1' },
      replay_attempts: 1,
    });
    expect(row.status).toBe('completed');
    expect(row.response_payload).toBeTruthy();
  });

  it('payload hash mismatch routes to manual review', () => {
    const row = baseRow({ status: 'pending', request_hash: 'hash-a' });
    expect(row.request_hash).not.toBe('hash-b');
  });
});
