/**
 * Supplier Matching Utilities
 * Functions for normalizing and matching supplier names, phones, and calculating match confidence
 */

/**
 * Normalize business name for comparison
 * Removes common suffixes, special characters, and normalizes whitespace
 */
export function normalizeBusinessName(name: string): string {
  if (!name) return '';
  
  return name
    .toLowerCase()
    .trim()
    // Remove common business suffixes
    .replace(/\b(pvt|ltd|limited|inc|incorporated|llp|llc|corp|corporation|co|company)\b\.?/gi, '')
    // Remove special characters
    .replace(/[^a-z0-9\s]/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize phone number for comparison
 * Removes all non-digit characters
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

/**
 * Calculate match confidence based on various factors
 */
export interface MatchResult {
  confidence: number;
  matchedFields: string[];
  reason: string;
}

export function calculateMatchConfidence(
  supplierGstin: string | null | undefined,
  supplierPhone: string | null | undefined,
  supplierName: string | null | undefined,
  searchGstin: string | null | undefined,
  searchPhone: string | null | undefined,
  searchName: string | null | undefined,
  nameSimilarity?: number
): MatchResult {
  const matchedFields: string[] = [];
  let confidence = 0;
  let reason = '';

  // Priority 1: GSTIN exact match (100% confidence)
  if (supplierGstin && searchGstin && 
      supplierGstin.trim().toUpperCase() === searchGstin.trim().toUpperCase()) {
    confidence = 100;
    matchedFields.push('GSTIN');
    reason = 'Exact GSTIN match';
    return { confidence, matchedFields, reason };
  }

  // Priority 2: Phone normalized match (90% confidence)
  if (supplierPhone && searchPhone) {
    const normalizedSupplierPhone = normalizePhone(supplierPhone);
    const normalizedSearchPhone = normalizePhone(searchPhone);
    
    if (normalizedSupplierPhone && normalizedSearchPhone && 
        normalizedSupplierPhone === normalizedSearchPhone) {
      confidence = 90;
      matchedFields.push('Phone');
      reason = 'Exact phone number match';
      return { confidence, matchedFields, reason };
    }
  }

  // Priority 3: Name similarity (80% for high similarity, 60% for medium)
  if (nameSimilarity !== undefined && supplierName && searchName) {
    if (nameSimilarity > 0.8) {
      confidence = 80;
      matchedFields.push('Name');
      reason = `High name similarity (${Math.round(nameSimilarity * 100)}%)`;
      return { confidence, matchedFields, reason };
    } else if (nameSimilarity > 0.6) {
      confidence = 60;
      matchedFields.push('Name');
      reason = `Medium name similarity (${Math.round(nameSimilarity * 100)}%)`;
      return { confidence, matchedFields, reason };
    }
  }

  // No match
  confidence = 0;
  reason = 'No significant match found';
  return { confidence, matchedFields, reason };
}
