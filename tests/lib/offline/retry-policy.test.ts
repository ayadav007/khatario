import { computeRetryDelayMs, shouldRetry } from '@/lib/offline/sync/retry-policy';

describe('retry policy', () => {
  it('caps retry attempts', () => {
    expect(shouldRetry(7)).toBe(true);
    expect(shouldRetry(8)).toBe(false);
  });

  it('returns delay within bounds', () => {
    const delay = computeRetryDelayMs(3, {
      baseDelayMs: 1000,
      maxDelayMs: 5000,
    });
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(5000);
  });
});
