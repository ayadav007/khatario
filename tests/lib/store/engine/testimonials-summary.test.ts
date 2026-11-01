import { summaryLine } from '@/lib/store/engine/testimonials-summary';

describe('testimonials summary', () => {
  it('averages to one decimal and pluralises', () => {
    expect(summaryLine([5, 4, 5])).toBe('4.7 / 5 from 3 reviews');
    expect(summaryLine([5])).toBe('5.0 / 5 from 1 review');
    expect(summaryLine([])).toBeNull();
  });
});
