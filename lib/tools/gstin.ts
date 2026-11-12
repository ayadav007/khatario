/** GSTIN shape check: 15 characters in the GSTIN pattern. It does not check the last (check) character's value. */
export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;

export function looksLikeGstin(value: string): boolean {
  return GSTIN_FORMAT.test(value.trim().toUpperCase());
}
