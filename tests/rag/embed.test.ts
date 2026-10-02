import { parseRateLimit } from '@/lib/rag/embed';

function body(details: unknown[]): string {
  return JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details } });
}

describe('parseRateLimit', () => {
  it('reads the retry delay of a per-minute quota', () => {
    const info = parseRateLimit(
      body([
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'EmbedContentRequestsPerMinutePerProjectPerModel-FreeTier' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
      ]),
    );
    expect(info).toEqual({ retryAfterMs: 37_000, daily: false });
  });

  it('flags a per-day quota so indexing stops instead of waiting', () => {
    const info = parseRateLimit(
      body([
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'EmbedContentRequestsPerDayPerProjectPerModel-FreeTier' }],
        },
      ]),
    );
    expect(info.daily).toBe(true);
  });

  it('copes with a non-JSON body', () => {
    expect(parseRateLimit('Too Many Requests')).toEqual({ retryAfterMs: null, daily: false });
  });
});
