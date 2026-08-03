import {
  calculateSimilarity,
  normalizeSupplierName,
  type SupplierMatchResult,
} from '@/lib/matching/supplier-matcher';

export type LocalSupplierRow = {
  id: string;
  name: string;
  gstin?: string | null;
  state_code?: string | null;
};

export type LocalSupplierMatch = {
  supplier: LocalSupplierRow;
  matchType: SupplierMatchResult['matchType'];
  similarityScore: number;
  confidence: SupplierMatchResult['confidence'];
};

const AUTO_LINK_MIN_SCORE = 88;
const STRONG_SUGGESTION_MIN_SCORE = 82;

function gstinNorm(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

function scoreSupplier(extractedName: string, supplierName: string): number {
  const direct = calculateSimilarity(extractedName, supplierName);
  const normalized = normalizeSupplierName(extractedName);
  const normalizedSupplier = normalizeSupplierName(supplierName);
  if (normalized && normalizedSupplier && normalized === normalizedSupplier) {
    return 100;
  }
  return Math.max(direct, calculateSimilarity(normalized, normalizedSupplier));
}

/** Rank catalogue suppliers against extracted bill party (sync, in-memory). */
export function rankLocalSupplierMatches(
  suppliers: LocalSupplierRow[],
  extracted: { name?: string | null; gstin?: string | null }
): LocalSupplierMatch[] {
  const extGstin = gstinNorm(extracted.gstin);
  const extName = (extracted.name || '').trim();
  if (!extName && extGstin.length !== 15) return [];

  const ranked: LocalSupplierMatch[] = [];

  for (const supplier of suppliers) {
    const supGstin = gstinNorm(supplier.gstin);
    if (extGstin.length === 15 && supGstin.length === 15 && extGstin === supGstin) {
      ranked.push({
        supplier,
        matchType: 'exact_gstin',
        similarityScore: 100,
        confidence: 'high',
      });
      continue;
    }

    if (!extName) continue;

    const score = scoreSupplier(extName, supplier.name);
    if (score < STRONG_SUGGESTION_MIN_SCORE) continue;

    const normalizedEqual =
      normalizeSupplierName(extName) === normalizeSupplierName(supplier.name);

    ranked.push({
      supplier,
      matchType: normalizedEqual ? 'exact_name' : 'fuzzy',
      similarityScore: score,
      confidence: score >= 88 ? 'high' : score >= 75 ? 'medium' : 'low',
    });
  }

  ranked.sort((a, b) => b.similarityScore - a.similarityScore);
  return ranked;
}

/** Pick a single supplier when match confidence is high enough to auto-link. */
export function findAutoLinkLocalSupplierMatch(
  suppliers: LocalSupplierRow[],
  extracted: { name?: string | null; gstin?: string | null }
): LocalSupplierMatch | null {
  const ranked = rankLocalSupplierMatches(suppliers, extracted);
  if (ranked.length === 0) return null;

  const best = ranked[0];
  if (best.matchType === 'exact_gstin' || best.matchType === 'exact_name') {
    return best;
  }

  if (best.similarityScore < AUTO_LINK_MIN_SCORE) return null;

  const second = ranked[1];
  if (!second || second.similarityScore < 75 || best.similarityScore - second.similarityScore >= 8) {
    return best;
  }

  return null;
}

/** True when catalogue already has likely matches — hide “New party” badge. */
export function hasStrongLocalSupplierSuggestions(
  suppliers: LocalSupplierRow[],
  searchText: string
): boolean {
  const q = searchText.trim();
  if (!q) return false;
  return rankLocalSupplierMatches(suppliers, { name: q }).length > 0;
}
