/**
 * Levenshtein edit distance (short strings: item names, invoice line labels)
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const c = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + c);
      prev = tmp;
    }
  }
  return row[n]!;
}

/** 0–100: 100 = identical, 0 = very different (short labels) */
export function levenshteinSimilarityPercent(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (s1.length === 0 && s2.length === 0) return 100;
  if (s1.length === 0 || s2.length === 0) return 0;
  if (s1 === s2) return 100;
  const d = levenshtein(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return Math.round(100 * (1 - d / maxLen));
}
