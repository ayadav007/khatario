import { angleForDate, imageStyleForDate, resolveImageStyle } from '@/lib/marketing/image-style';

describe('marketing image style', () => {
  it('alternates square and poster by the day of the year', () => {
    expect(imageStyleForDate('2026-01-01')).toBe('square');
    expect(imageStyleForDate('2026-01-02')).toBe('poster');
  });

  it('keeps an explicit style and otherwise follows the date', () => {
    expect(resolveImageStyle('poster', '2026-01-01')).toBe('poster');
    expect(resolveImageStyle('auto', '2026-01-01')).toBe('square');
  });

  it('rotates the daily angle', () => {
    expect(angleForDate('2026-01-01')).not.toBe(angleForDate('2026-01-02'));
    expect(angleForDate('2026-01-08')).toBe(angleForDate('2026-01-01'));
  });
});
