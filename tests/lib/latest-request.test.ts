import { describe, expect, it } from '@jest/globals';
import { createLatestRequest } from '@/lib/latest-request';

describe('createLatestRequest', () => {
  it('treats only the most recently started request as current', () => {
    const latest = createLatestRequest();
    const first = latest.start();
    const second = latest.start();
    expect(latest.isLatest(first)).toBe(false);
    expect(latest.isLatest(second)).toBe(true);
  });

  it('keeps a single request current until another starts', () => {
    const latest = createLatestRequest();
    const only = latest.start();
    expect(latest.isLatest(only)).toBe(true);
  });
});
