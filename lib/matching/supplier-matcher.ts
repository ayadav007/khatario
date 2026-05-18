/**
 * Smart supplier matching using GSTIN, fuzzy name matching, and aliases
 */

import { validateGSTIN } from './gstin-validator';

export interface SupplierMatchResult {
  supplierId: string;
  supplierName: string;
  gstin?: string;
  matchType: 'exact_gstin' | 'exact_name' | 'alias' | 'fuzzy' | 'none';
  similarityScore: number; // 0-100, higher is better
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  const matrix: number[][] = [];

  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[s2.length][s1.length];
}

/**
 * Calculate similarity score (0-100) based on Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  
  if (maxLength === 0) return 100;
  
  const similarity = ((maxLength - distance) / maxLength) * 100;
  return Math.round(similarity);
}

/**
 * Normalize supplier name for matching
 * Removes common suffixes, extra spaces, punctuation
 */
function normalizeSupplierName(name: string): string {
  let normalized = name.toLowerCase().trim();
  
  // Remove common suffixes
  const suffixes = [
    'pvt ltd', 'pvt. ltd.', 'private limited', 'pvt limited',
    'ltd', 'ltd.', 'limited',
    'llp', 'l.l.p.', 'llc', 'l.l.c.',
    'inc', 'inc.', 'incorporated',
    'co', 'co.', 'company', '& co', '& co.'
  ];
  
  for (const suffix of suffixes) {
    const pattern = new RegExp(`\\s+${suffix.replace('.', '\\.')}$`, 'i');
    normalized = normalized.replace(pattern, '');
  }
  
  // Remove punctuation except spaces
  normalized = normalized.replace(/[^\w\s]/g, '');
  
  // Normalize spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Match supplier by GSTIN and name
 * Returns best matches sorted by confidence
 */
export async function matchSupplier(
  businessId: string,
  extractedData: {
    name?: string;
    gstin?: string;
  }
): Promise<SupplierMatchResult[]> {
  const matches: SupplierMatchResult[] = [];

  try {
    // 1. Try exact GSTIN match first (highest confidence)
    if (extractedData.gstin) {
      const gstinValidation = validateGSTIN(extractedData.gstin);
      
      if (gstinValidation.isValid) {
        const response = await fetch(`/api/suppliers?business_id=${businessId}&gstin=${extractedData.gstin}`);
        const data = await response.json();
        
        if (data.suppliers && data.suppliers.length > 0) {
          const supplier = data.suppliers[0];
          matches.push({
            supplierId: supplier.id,
            supplierName: supplier.name,
            gstin: supplier.gstin,
            matchType: 'exact_gstin',
            similarityScore: 100,
            confidence: 'high'
          });
          
          return matches; // GSTIN match is definitive
        }
      }
    }

    // 2. Get all suppliers for this business
    const response = await fetch(`/api/suppliers?business_id=${businessId}`);
    const data = await response.json();
    
    if (!data.suppliers || data.suppliers.length === 0) {
      return matches;
    }

    const suppliers = data.suppliers;
    const extractedName = extractedData.name?.trim() || '';
    
    if (!extractedName) {
      return matches;
    }

    const normalizedExtractedName = normalizeSupplierName(extractedName);

    // 3. Try exact name match
    for (const supplier of suppliers) {
      const normalizedSupplierName = normalizeSupplierName(supplier.name);
      
      if (normalizedSupplierName === normalizedExtractedName) {
        matches.push({
          supplierId: supplier.id,
          supplierName: supplier.name,
          gstin: supplier.gstin,
          matchType: 'exact_name',
          similarityScore: 100,
          confidence: 'high'
        });
      }
    }

    // 4. Try alias matching
    try {
      const aliasResponse = await fetch(`/api/suppliers/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          name: extractedName
        })
      });
      
      if (aliasResponse.ok) {
        const aliasData = await aliasResponse.json();
        
        if (aliasData.match) {
          const existingMatch = matches.find(m => m.supplierId === aliasData.match.supplier_id);
          
          if (!existingMatch) {
            matches.push({
              supplierId: aliasData.match.supplier_id,
              supplierName: aliasData.match.supplier_name,
              gstin: aliasData.match.gstin,
              matchType: 'alias',
              similarityScore: 95,
              confidence: 'high'
            });
          }
        }
      }
    } catch (error) {
      console.error('Alias matching error:', error);
    }

    // 5. Fuzzy matching on all suppliers
    const fuzzyMatches: SupplierMatchResult[] = [];
    
    for (const supplier of suppliers) {
      // Skip if already matched
      if (matches.some(m => m.supplierId === supplier.id)) {
        continue;
      }

      const similarity = calculateSimilarity(extractedName, supplier.name);
      
      // Only include if similarity is above threshold (70%)
      if (similarity >= 70) {
        fuzzyMatches.push({
          supplierId: supplier.id,
          supplierName: supplier.name,
          gstin: supplier.gstin,
          matchType: 'fuzzy',
          similarityScore: similarity,
          confidence: similarity >= 85 ? 'high' : similarity >= 75 ? 'medium' : 'low'
        });
      }
    }

    // Sort fuzzy matches by similarity score
    fuzzyMatches.sort((a, b) => b.similarityScore - a.similarityScore);
    
    // Add top 3 fuzzy matches
    matches.push(...fuzzyMatches.slice(0, 3));

    return matches;

  } catch (error) {
    console.error('Supplier matching error:', error);
    return matches;
  }
}

/**
 * Create supplier alias after successful match
 */
export async function createSupplierAlias(
  supplierId: string,
  aliasName: string,
  aliasType: 'manual' | 'auto_learned' | 'extracted' = 'extracted'
): Promise<boolean> {
  try {
    const response = await fetch(`/api/suppliers/${supplierId}/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alias_name: aliasName,
        alias_type: aliasType
      })
    });

    return response.ok;
  } catch (error) {
    console.error('Error creating supplier alias:', error);
    return false;
  }
}
