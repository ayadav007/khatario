/**
 * GST Utility Functions
 * Shared utilities for GST compliance features
 */

/**
 * Convert Indian state/UT name to 2-digit GST state code
 * 
 * @param stateName - Full state name (e.g., "Karnataka", "Tamil Nadu")
 * @returns 2-digit GST state code (e.g., "29", "33") or empty string if not found
 */
export function getStateCode(stateName: string): string {
  if (!stateName) return '';
  
  const name = stateName.trim().toLowerCase();
  
  const stateCodeMap: Record<string, string> = {
    // States
    'andhra pradesh': '37',
    'arunachal pradesh': '12',
    'assam': '18',
    'bihar': '10',
    'chhattisgarh': '22',
    'goa': '30',
    'gujarat': '24',
    'haryana': '06',
    'himachal pradesh': '02',
    'jharkhand': '20',
    'karnataka': '29',
    'kerala': '32',
    'madhya pradesh': '23',
    'maharashtra': '27',
    'manipur': '14',
    'meghalaya': '17',
    'mizoram': '15',
    'nagaland': '13',
    'odisha': '21',
    'punjab': '03',
    'rajasthan': '08',
    'sikkim': '11',
    'tamil nadu': '33',
    'tamilnadu': '33', // Alternative spelling
    'telangana': '36',
    'tripura': '16',
    'uttar pradesh': '09',
    'uttarakhand': '05',
    'west bengal': '19',
    
    // Union Territories
    'andaman and nicobar islands': '35',
    'chandigarh': '04',
    'dadra and nagar haveli and daman and diu': '26',
    'daman and diu': '26', // Legacy name
    'dadra and nagar haveli': '26', // Legacy name
    'jammu and kashmir': '01',
    'ladakh': '38',
    'lakshadweep': '31',
    'puducherry': '34',
    'pondicherry': '34', // Alternative name
    'delhi': '07',
    'nct of delhi': '07',
  };
  
  return stateCodeMap[name] || '';
}

/**
 * Get state name from GST state code (reverse lookup)
 * 
 * @param stateCode - 2-digit GST state code (e.g., "29")
 * @returns Full state name (e.g., "Karnataka") or empty string if not found
 */
export function getStateName(stateCode: string): string {
  if (!stateCode) return '';
  
  const codeToStateMap: Record<string, string> = {
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
    '25': 'Daman and Diu', // Legacy
    '26': 'Dadra and Nagar Haveli and Daman and Diu',
    '27': 'Maharashtra',
    '28': 'Andhra Pradesh', // Legacy (pre-bifurcation)
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
  };
  
  return codeToStateMap[stateCode] || '';
}

/**
 * List of all Indian States and Union Territories for dropdowns
 */
export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
  'Delhi',
] as const;

/**
 * Validate GSTIN format
 * 
 * @param gstin - GSTIN to validate
 * @returns true if format is valid (15 characters, alphanumeric)
 */
export function isValidGSTIN(gstin: string): boolean {
  if (!gstin) return false;
  // GSTIN format: 15 characters, alphanumeric
  const gstinRegex = /^[0-9A-Z]{15}$/;
  return gstinRegex.test(gstin.toUpperCase());
}

/**
 * Validate HSN/SAC code format
 * 
 * @param hsnSac - HSN or SAC code to validate
 * @returns true if format is valid
 */
export function isValidHSNSAC(hsnSac: string): boolean {
  if (!hsnSac) return false;
  // HSN: 4-8 digits, SAC: 6 digits
  const hsnSacRegex = /^[0-9]{4,8}$/;
  return hsnSacRegex.test(hsnSac);
}

