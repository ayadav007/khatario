import { countdownParts, countdownUnits } from '@/components/store/engine/sections/countdown-logic';

describe('countdownUnits', () => {
  it('drops days when zero and gives zeros when over', () => {
    const end = '2026-12-31T20:00:00Z';
    const endMs = Date.parse(end);
    expect(countdownUnits(countdownParts(end, endMs - 3_725_000))).toEqual([['Hrs', 1], ['Min', 2], ['Sec', 5]]);
    expect(countdownUnits(null)).toEqual([['Hrs', 0], ['Min', 0], ['Sec', 0]]);
  });

  it('keeps days when there are some', () => {
    const end = '2026-12-31T20:00:00Z';
    const endMs = Date.parse(end);
    expect(countdownUnits(countdownParts(end, endMs - 90_061_000))).toEqual([['Days', 1], ['Hrs', 1], ['Min', 1], ['Sec', 1]]);
  });

  it('shows zeros, not negatives, for a past time, and nothing to show for unreadable input is a null parts', () => {
    expect(countdownUnits(countdownParts('2020-01-01T00:00:00Z', Date.now()))).toEqual([['Hrs', 0], ['Min', 0], ['Sec', 0]]);
    expect(countdownParts('', 0)).toBeNull();
    expect(countdownParts('soon', 0)).toBeNull();
  });
});
