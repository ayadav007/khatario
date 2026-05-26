import { resolveConflict } from '@/lib/offline/sync/conflict-resolver';
import type { OfflineAction } from '@/lib/offline/types';

const baseAction = (type: OfflineAction['type']): OfflineAction => ({
  id: 'a1',
  businessId: 'b1',
  userId: 'u1',
  type,
  payload: { qty: 5 },
  idempotencyKey: 'key1',
  sequence: 1,
  status: 'pending',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  attempts: 0,
  lastError: null,
  optimisticRefs: ['item:1'],
  conflictStrategy: 'manual_review',
});

describe('resolveConflict', () => {
  it('requires manual review for GST-sensitive sales actions', () => {
    const result = resolveConflict({
      action: baseAction('sales.create'),
      serverPayload: { total: 100 },
      clientPayload: { total: 90 },
      serverVersion: 2,
      clientVersion: 1,
    });
    expect(result.outcome).toBe('manual_review');
  });

  it('applies server wins for stock adjust', () => {
    const action = { ...baseAction('stock.adjust'), conflictStrategy: 'server_wins' as const };
    const result = resolveConflict({
      action,
      serverPayload: { qty: 10 },
      clientPayload: { qty: 5 },
      serverVersion: 3,
      clientVersion: 2,
    });
    expect(result.outcome).toBe('apply_server');
    if (result.outcome === 'apply_server') {
      expect(result.payload).toEqual({ qty: 10 });
    }
  });
});
