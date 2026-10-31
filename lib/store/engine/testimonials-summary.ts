/** "4.7 / 5 from 3 reviews" for the Testimonials summary line; null when there are no ratings. */
export function summaryLine(ratings: number[]): string | null {
  if (ratings.length === 0) return null;
  const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  return `${avg.toFixed(1)} / 5 from ${ratings.length} ${ratings.length === 1 ? 'review' : 'reviews'}`;
}
