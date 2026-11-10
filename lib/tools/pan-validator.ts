/**
 * PAN format check. The fourth character is the holder type; the fifth is the first
 * letter of the holder's surname or name, so it says nothing about the entity.
 */
export const PAN_HOLDER_TYPES: Record<string, string> = {
  P: 'Individual',
  C: 'Company',
  H: 'Hindu Undivided Family (HUF)',
  F: 'Firm',
  A: 'Association of Persons (AOP)',
  T: 'Trust',
  B: 'Body of Individuals (BOI)',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government',
};

export interface PanValidation {
  isValid: boolean;
  pan?: string;
  holderType?: string;
  error?: string;
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function validatePan(input: string): PanValidation {
  const pan = (input || '').replace(/\s+/g, '').toUpperCase();
  if (!pan) return { isValid: false, error: 'Please enter a PAN number' };
  if (!PAN_REGEX.test(pan)) {
    return {
      isValid: false,
      pan,
      error: 'Invalid format. PAN should be in format: ABCDE1234F (5 letters, 4 digits, 1 letter)',
    };
  }
  const holderType = PAN_HOLDER_TYPES[pan[3]];
  if (!holderType) {
    return {
      isValid: false,
      pan,
      error: `Fourth character "${pan[3]}" is not a valid PAN holder type (P, C, H, F, A, T, B, L, J or G)`,
    };
  }
  return { isValid: true, pan, holderType };
}
