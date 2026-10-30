import { reviewStatusFor, histogram } from '@/lib/store/reviews';

describe('reviewStatusFor', () => {
  it('publishes a text-only review', () => {
    expect(reviewStatusFor([])).toBe('published');
  });
  it('holds a review with photos for approval', () => {
    expect(reviewStatusFor(['https://x/y.jpg'])).toBe('pending');
  });
});

describe('histogram', () => {
  it('returns zeros for no rows', () => {
    expect(histogram([])).toEqual({ avg: 0, count: 0, histogram: [0, 0, 0, 0, 0] });
  });
  it('orders buckets 5 stars first and rounds the average to 1 decimal', () => {
    const r = histogram([
      { rating: 5, n: 2 },
      { rating: 4, n: 1 },
      { rating: 1, n: 1 },
    ]);
    expect(r.histogram).toEqual([2, 1, 0, 0, 1]);
    expect(r.count).toBe(4);
    expect(r.avg).toBe(3.8); // (10 + 4 + 1) / 4 = 3.75 -> 3.8
  });
  it('ignores out-of-range ratings', () => {
    expect(histogram([{ rating: 9, n: 3 }, { rating: 3, n: 1 }]).count).toBe(1);
  });
});
