/**
 * Helper function to get state code from state name
 * Pure function - no side effects
 */
export function getStateCode(stateName: string): string {
  if (!stateName) return '';
  const name = stateName.trim().toLowerCase();
  
  const stateCodeMap: Record<string, string> = {
    'andhra pradesh': '37', 'karnataka': '29', 'tamil nadu': '33', 'maharashtra': '27',
    'gujarat': '24', 'rajasthan': '08', 'uttar pradesh': '09', 'west bengal': '19',
    'delhi': '07', 'telangana': '36', 'haryana': '06', 'punjab': '03', 'odisha': '21',
    'bihar': '10', 'madhya pradesh': '23', 'assam': '18', 'jharkhand': '20',
    'kerala': '32', 'chhattisgarh': '22', 'uttarakhand': '05', 'himachal pradesh': '02',
    'tripura': '16', 'manipur': '14', 'meghalaya': '17', 'mizoram': '15',
    'nagaland': '13', 'arunachal pradesh': '12', 'goa': '30', 'sikkim': '11',
    'andaman and nicobar islands': '35', 'chandigarh': '04',
    'dadra and nagar haveli and daman and diu': '26', 'jammu and kashmir': '01',
    'ladakh': '38', 'lakshadweep': '31', 'puducherry': '34'
  };
  return stateCodeMap[name] || '';
}

