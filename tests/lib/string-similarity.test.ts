import { levenshtein, levenshteinSimilarityPercent } from '@/lib/string-similarity';

describe('string-similarity', () => {
  it('levenshtein distance', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('a', 'a')).toBe(0);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('book', 'back')).toBe(2);
  });

  it('levenshteinSimilarityPercent', () => {
    expect(levenshteinSimilarityPercent('same', 'same')).toBe(100);
    expect(levenshteinSimilarityPercent('Abc', 'abc')).toBe(100);
    expect(levenshteinSimilarityPercent('', '')).toBe(100);
  });
});
