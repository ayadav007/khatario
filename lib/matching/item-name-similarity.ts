/**
 * Shared item-name similarity (used by item-matcher UI and purchase stock resolution).
 */

import { levenshteinSimilarityPercent } from '@/lib/string-similarity';

/** Normalize for comparison: lower, trim, collapse spaces */
export function normalizeItemLabel(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * 0–100 score; mirrors legacy `calculateSimilarity` in item-matcher (invoices UI).
 */
export function calculateItemNameSimilarity(str1: string, str2: string): number {
  const s1 = normalizeItemLabel(str1);
  const s2 = normalizeItemLabel(str2);

  if (s1.length === 0 || s2.length === 0) return s1 === s2 ? 100 : 0;
  if (s1 === s2) return 100;

  if (s1.includes(s2) || s2.includes(s1)) {
    return Math.max(85, levenshteinSimilarityPercent(s1, s2));
  }

  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);

  let matchingWords = 0;
  for (const word1 of words1) {
    if (word1.length === 0) continue;
    if (words2.some((word2) => word2.includes(word1) || word1.includes(word2))) {
      matchingWords++;
    }
  }

  const similarity = (matchingWords / Math.max(words1.length, words2.length)) * 100;
  return Math.max(Math.round(similarity), levenshteinSimilarityPercent(s1, s2));
}
