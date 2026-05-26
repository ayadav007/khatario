import { compareOfflineActions } from '@/lib/offline/sync/action-order';

describe('action-order', () => {
  it('sorts by priority then sequence', () => {
    const sorted = [
      { type: 'payment.record' as const, sequence: 1 },
      { type: 'sales.finalize' as const, sequence: 2 },
      { type: 'purchase.finalize' as const, sequence: 3 },
    ].sort(compareOfflineActions);

    expect(sorted.map((a) => a.type)).toEqual([
      'purchase.finalize',
      'sales.finalize',
      'payment.record',
    ]);
  });
});
