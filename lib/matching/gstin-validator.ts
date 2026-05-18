/**
 * GSTIN (GST Identification Number) validation utilities
 * Format: 15 characters - 2 (State) + 10 (PAN) + 1 (Entity) + 1 (Z) + 1 (Check)
 */

export interface GSTINValidationResult {
  isValid: boolean;
  stateCode?: string;
  panNumber?: string;
  entityNumber?: string;
  checkDigit?: string;
  errors: string[];
}

/**
 * Validate GSTIN format and structure
 */
export function validateGSTIN(gstin: string | null | undefined): GSTINValidationResult {
  const result: GSTINValidationResult = {
    isValid: false,
    errors: []
  };

  // Check if GSTIN is provided
  if (!gstin) {
    result.errors.push('GSTIN is required');
    return result;
  }

  // Remove whitespace and convert to uppercase
  const cleanGSTIN = gstin.trim().toUpperCase();

  // Check length
  if (cleanGSTIN.length !== 15) {
    result.errors.push(`GSTIN must be exactly 15 characters (got ${cleanGSTIN.length})`);
    return result;
  }

  // GSTIN format: 99AAAAA9999A9Z9
  // Position:      01234567890123 4
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  if (!gstinRegex.test(cleanGSTIN)) {
    result.errors.push('Invalid GSTIN format');
    return result;
  }

  // Extract components
  const stateCode = cleanGSTIN.substring(0, 2);
  const panNumber = cleanGSTIN.substring(2, 12);
  const entityNumber = cleanGSTIN.substring(12, 13);
  const zChar = cleanGSTIN.substring(13, 14);
  const checkDigit = cleanGSTIN.substring(14, 15);

  // Validate state code
  const validStateCodes = [
    '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
    '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
    '31', '32', '33', '34', '35', '36', '37', '38', '97', '99'
  ];

  if (!validStateCodes.includes(stateCode)) {
    result.errors.push(`Invalid state code: ${stateCode}`);
  }

  // Z must be 'Z'
  if (zChar !== 'Z') {
    result.errors.push('13th character must be Z');
  }

  // If no errors, it's valid
  if (result.errors.length === 0) {
    result.isValid = true;
    result.stateCode = stateCode;
    result.panNumber = panNumber;
    result.entityNumber = entityNumber;
    result.checkDigit = checkDigit;
  }

  return result;
}

/**
 * Get state name from GSTIN state code
 */
export function getStateFromGSTIN(gstin: string): string | null {
  const validation = validateGSTIN(gstin);
  if (!validation.isValid || !validation.stateCode) {
    return null;
  }

  const stateMap: Record<string, string> = {
    '01': 'Jammu and Kashmir',
    '02': 'Himachal Pradesh',
    '03': 'Punjab',
    '04': 'Chandigarh',
    '05': 'Uttarakhand',
    '06': 'Haryana',
    '07': 'Delhi',
    '08': 'Rajasthan',
    '09': 'Uttar Pradesh',
    '10': 'Bihar',
    '11': 'Sikkim',
    '12': 'Arunachal Pradesh',
    '13': 'Nagaland',
    '14': 'Manipur',
    '15': 'Mizoram',
    '16': 'Tripura',
    '17': 'Meghalaya',
    '18': 'Assam',
    '19': 'West Bengal',
    '20': 'Jharkhand',
    '21': 'Odisha',
    '22': 'Chhattisgarh',
    '23': 'Madhya Pradesh',
    '24': 'Gujarat',
    '25': 'Daman and Diu',
    '26': 'Dadra and Nagar Haveli and Daman and Diu',
    '27': 'Maharashtra',
    '28': 'Andhra Pradesh (Before Division)',
    '29': 'Karnataka',
    '30': 'Goa',
    '31': 'Lakshadweep',
    '32': 'Kerala',
    '33': 'Tamil Nadu',
    '34': 'Puducherry',
    '35': 'Andaman and Nicobar Islands',
    '36': 'Telangana',
    '37': 'Andhra Pradesh',
    '38': 'Ladakh',
    '97': 'Other Territory',
    '99': 'Centre Jurisdiction'
  };

  return stateMap[validation.stateCode] || null;
}

/**
 * Check if two GSTINs belong to the same state
 */
export function isSameState(gstin1: string, gstin2: string): boolean {
  const val1 = validateGSTIN(gstin1);
  const val2 = validateGSTIN(gstin2);

  if (!val1.isValid || !val2.isValid) {
    return false;
  }

  return val1.stateCode === val2.stateCode;
}

/**
 * Format GSTIN for display (add spaces for readability)
 */
export function formatGSTIN(gstin: string): string {
  const validation = validateGSTIN(gstin);
  if (!validation.isValid) {
    return gstin;
  }

  const clean = gstin.trim().toUpperCase();
  // Format: 99 AAAAA 9999 A 9 Z 9
  return `${clean.substring(0, 2)} ${clean.substring(2, 7)} ${clean.substring(7, 11)} ${clean.substring(11, 12)} ${clean.substring(12, 13)} ${clean.substring(13, 14)} ${clean.substring(14, 15)}`;
}
