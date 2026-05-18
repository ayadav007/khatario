/**
 * HSN/SAC code matching and validation utilities
 * HSN: Harmonized System of Nomenclature (goods)
 * SAC: Services Accounting Code (services)
 */

export interface HSNSACValidationResult {
  isValid: boolean;
  type: 'hsn' | 'sac' | 'unknown';
  code: string;
  errors: string[];
}

/**
 * Validate HSN/SAC code format
 * HSN: 4, 6, or 8 digits
 * SAC: 6 digits
 */
export function validateHSNSAC(code: string | null | undefined): HSNSACValidationResult {
  const result: HSNSACValidationResult = {
    isValid: false,
    type: 'unknown',
    code: '',
    errors: []
  };

  if (!code) {
    result.errors.push('HSN/SAC code is required');
    return result;
  }

  // Clean code (remove spaces and special characters)
  const cleanCode = code.trim().replace(/[^0-9]/g, '');
  result.code = cleanCode;

  // Check if it's all digits
  if (!/^\d+$/.test(cleanCode)) {
    result.errors.push('HSN/SAC code must contain only digits');
    return result;
  }

  // Determine type and validate length
  const length = cleanCode.length;

  if (length === 4 || length === 6 || length === 8) {
    // Could be HSN
    result.type = 'hsn';
    result.isValid = true;
  } else if (length === 6) {
    // Could be SAC
    result.type = 'sac';
    result.isValid = true;
  } else {
    result.errors.push(`Invalid HSN/SAC length: ${length} (expected 4, 6, or 8 digits)`);
  }

  return result;
}

/**
 * Format HSN/SAC code for display
 * HSN 8-digit: 1234 5678
 * HSN 6-digit: 1234 56
 * HSN 4-digit: 1234
 * SAC: 995411
 */
export function formatHSNSAC(code: string): string {
  const validation = validateHSNSAC(code);
  
  if (!validation.isValid) {
    return code;
  }

  const cleanCode = validation.code;

  if (cleanCode.length === 8) {
    return `${cleanCode.substring(0, 4)} ${cleanCode.substring(4, 8)}`;
  } else if (cleanCode.length === 6 && validation.type === 'hsn') {
    return `${cleanCode.substring(0, 4)} ${cleanCode.substring(4, 6)}`;
  } else {
    return cleanCode;
  }
}

/**
 * Get description category from HSN code (first 2 digits)
 */
export function getHSNCategory(hsnCode: string): string | null {
  const validation = validateHSNSAC(hsnCode);
  
  if (!validation.isValid || validation.type !== 'hsn') {
    return null;
  }

  const chapter = validation.code.substring(0, 2);
  
  // Map of HSN chapters (first 2 digits) to categories
  // This is a simplified mapping - full HSN has 99 chapters
  const chapterMap: Record<string, string> = {
    '01': 'Live Animals',
    '02': 'Meat and Edible Meat Offal',
    '03': 'Fish and Crustaceans',
    '04': 'Dairy Products',
    '05': 'Products of Animal Origin',
    '06': 'Live Trees and Plants',
    '07': 'Edible Vegetables',
    '08': 'Edible Fruits and Nuts',
    '09': 'Coffee, Tea, Spices',
    '10': 'Cereals',
    // Electronics
    '84': 'Machinery and Mechanical Appliances',
    '85': 'Electrical Machinery and Equipment',
    // Common goods
    '39': 'Plastics and Articles',
    '40': 'Rubber and Articles',
    '48': 'Paper and Paperboard',
    '61': 'Apparel and Clothing (Knitted)',
    '62': 'Apparel and Clothing (Not Knitted)',
    '64': 'Footwear',
    '73': 'Articles of Iron or Steel',
    '94': 'Furniture and Bedding'
  };

  return chapterMap[chapter] || `HSN Chapter ${chapter}`;
}

/**
 * Check if HSN/SAC code matches or is related
 * Considers hierarchical nature of HSN (8-digit contains 6-digit, etc.)
 */
export function isHSNSACMatch(code1: string, code2: string): boolean {
  const val1 = validateHSNSAC(code1);
  const val2 = validateHSNSAC(code2);

  if (!val1.isValid || !val2.isValid) {
    return false;
  }

  // Exact match
  if (val1.code === val2.code) {
    return true;
  }

  // Hierarchical match (e.g., 8517 matches 85171000)
  const shorter = val1.code.length < val2.code.length ? val1.code : val2.code;
  const longer = val1.code.length >= val2.code.length ? val1.code : val2.code;

  return longer.startsWith(shorter);
}

/**
 * Extract HSN/SAC codes from text
 */
export function extractHSNSACFromText(text: string): string[] {
  const codes: string[] = [];
  
  // Pattern for HSN/SAC: 4, 6, or 8 digits
  // Look for patterns like "HSN: 1234" or standalone 4-8 digit numbers
  const patterns = [
    /HSN[:\s]+(\d{4,8})/gi,
    /SAC[:\s]+(\d{6})/gi,
    /\b(\d{4})\b/g,  // 4-digit codes
    /\b(\d{6})\b/g,  // 6-digit codes
    /\b(\d{8})\b/g   // 8-digit codes
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const code = match[1];
      const validation = validateHSNSAC(code);
      if (validation.isValid && !codes.includes(validation.code)) {
        codes.push(validation.code);
      }
    }
  }

  return codes;
}
