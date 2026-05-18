/**
 * Smart item matching using HSN/SAC codes and fuzzy name matching
 */

import { validateHSNSAC, isHSNSACMatch } from './hsn-sac-matcher';
import { calculateItemNameSimilarity } from '@/lib/matching/item-name-similarity';

export interface ItemMatchResult {
  itemId: string;
  itemName: string;
  hsnSac?: string;
  sellingPrice?: number;
  purchasePrice?: number;
  taxRate?: number;
  matchType: 'exact_hsn' | 'exact_name' | 'fuzzy_name' | 'hsn_related' | 'none';
  similarityScore: number; // 0-100
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Match item from catalog based on extracted invoice line item
 */
export async function matchItem(
  businessId: string,
  extractedItem: {
    name: string;
    hsnSac?: string;
    description?: string;
  }
): Promise<ItemMatchResult[]> {
  const matches: ItemMatchResult[] = [];

  try {
    // Get all items for this business
    const response = await fetch(`/api/items?business_id=${businessId}`);
    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return matches;
    }

    const items = data.items;
    const extractedName = extractedItem.name.trim();
    const extractedHSN = extractedItem.hsnSac?.trim();

    // 1. Try exact HSN/SAC match first
    if (extractedHSN) {
      const hsnValidation = validateHSNSAC(extractedHSN);

      if (hsnValidation.isValid) {
        for (const item of items) {
          if (item.hsn_sac && isHSNSACMatch(extractedHSN, item.hsn_sac)) {
            // Exact HSN match
            if (item.hsn_sac === extractedHSN) {
              matches.push({
                itemId: item.id,
                itemName: item.name,
                hsnSac: item.hsn_sac,
                sellingPrice: item.selling_price,
                purchasePrice: item.purchase_price,
                taxRate: item.tax_rate,
                matchType: 'exact_hsn',
                similarityScore: 100,
                confidence: 'high'
              });
            }
            // Related HSN (hierarchical match)
            else {
              matches.push({
                itemId: item.id,
                itemName: item.name,
                hsnSac: item.hsn_sac,
                sellingPrice: item.selling_price,
                purchasePrice: item.purchase_price,
                taxRate: item.tax_rate,
                matchType: 'hsn_related',
                similarityScore: 90,
                confidence: 'high'
              });
            }
          }
        }
      }
    }

    // 2. Try exact name match
    for (const item of items) {
      const normalizedItemName = item.name.toLowerCase().trim();
      const normalizedExtractedName = extractedName.toLowerCase().trim();

      if (normalizedItemName === normalizedExtractedName) {
        // Avoid duplicates
        if (!matches.some(m => m.itemId === item.id)) {
          matches.push({
            itemId: item.id,
            itemName: item.name,
            hsnSac: item.hsn_sac,
            sellingPrice: item.selling_price,
            purchasePrice: item.purchase_price,
            taxRate: item.tax_rate,
            matchType: 'exact_name',
            similarityScore: 100,
            confidence: 'high'
          });
        }
      }
    }

    // 3. Fuzzy name matching
    const fuzzyMatches: ItemMatchResult[] = [];

    for (const item of items) {
      // Skip if already matched
      if (matches.some(m => m.itemId === item.id)) {
        continue;
      }

      const similarity = calculateItemNameSimilarity(extractedName, item.name);

      // Also check description if available
      let descriptionSimilarity = 0;
      if (extractedItem.description && item.description) {
        descriptionSimilarity = calculateItemNameSimilarity(
          extractedItem.description,
          item.description
        );
      }

      const maxSimilarity = Math.max(similarity, descriptionSimilarity);

      // Only include if similarity is above threshold (60%)
      if (maxSimilarity >= 60) {
        fuzzyMatches.push({
          itemId: item.id,
          itemName: item.name,
          hsnSac: item.hsn_sac,
          sellingPrice: item.selling_price,
          purchasePrice: item.purchase_price,
          taxRate: item.tax_rate,
          matchType: 'fuzzy_name',
          similarityScore: maxSimilarity,
          confidence: maxSimilarity >= 80 ? 'high' : maxSimilarity >= 70 ? 'medium' : 'low'
        });
      }
    }

    // Sort fuzzy matches by similarity
    fuzzyMatches.sort((a, b) => b.similarityScore - a.similarityScore);

    // Add top 5 fuzzy matches
    matches.push(...fuzzyMatches.slice(0, 5));

    return matches;

  } catch (error) {
    console.error('Item matching error:', error);
    return matches;
  }
}

/**
 * Create new item from extracted data
 */
export async function createItemFromExtraction(
  businessId: string,
  extractedItem: {
    name: string;
    hsnSac?: string;
    unit?: string;
    taxRate?: number;
    description?: string;
  }
): Promise<{ success: boolean; itemId?: string; error?: string }> {
  try {
    const response = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: businessId,
        name: extractedItem.name,
        description: extractedItem.description || '',
        hsn_sac: extractedItem.hsnSac || '',
        unit: extractedItem.unit || 'PCS',
        tax_rate: extractedItem.taxRate || 0,
        type: 'goods', // Default to goods
        is_active: true
      })
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        itemId: data.item?.id
      };
    } else {
      const error = await response.json();
      return {
        success: false,
        error: error.error || 'Failed to create item'
      };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'An error occurred'
    };
  }
}
