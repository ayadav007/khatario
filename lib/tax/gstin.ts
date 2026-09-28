import { panFromGstin } from '@/lib/tax/pan';

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Regular taxpayer, TDS/TCS, NRTP, UN body and OIDAR layouts all share this shape. */
const GSTIN_SHAPE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{1}[A-Z0-9]{1}[0-9A-Z]{1}$/;

export const GST_STATE_NAMES: Record<string, string> = {
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
  '99': 'Centre Jurisdiction',
};

/** GSTN check character: weighted base-36 sum over the first 14 characters (factors 1,2,1,2…). */
export function gstinCheckChar(first14: string): string | null {
  if (first14.length !== 14) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARSET.indexOf(first14[i]);
    if (v < 0) return null;
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export type GstinCheck =
  | { valid: true; gstin: string; stateCode: string; stateName: string | null; pan: string | null }
  | { valid: false; gstin: string; error: string; code: 'LENGTH' | 'FORMAT' | 'STATE' | 'CHECKSUM' };

export function checkGstin(value: unknown): GstinCheck {
  const gstin = typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : '';
  if (gstin.length !== 15) {
    return { valid: false, gstin, code: 'LENGTH', error: `GSTIN must be exactly 15 characters (got ${gstin.length})` };
  }
  if (!GSTIN_SHAPE.test(gstin)) {
    return { valid: false, gstin, code: 'FORMAT', error: 'Invalid GSTIN format. Expected e.g. 27AAPFU0939F1ZV' };
  }
  const stateCode = gstin.slice(0, 2);
  if (!GST_STATE_NAMES[stateCode]) {
    return { valid: false, gstin, code: 'STATE', error: `Invalid GSTIN state code ${stateCode}` };
  }
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return { valid: false, gstin, code: 'CHECKSUM', error: 'GSTIN check digit does not match — please re-check the number' };
  }
  return { valid: true, gstin, stateCode, stateName: GST_STATE_NAMES[stateCode], pan: panFromGstin(gstin) };
}

export function isValidGstin(value: unknown): boolean {
  return checkGstin(value).valid;
}

/**
 * Normalises an optional GSTIN field from a request body.
 * Empty → null (unregistered); invalid → error message; valid → canonical GSTIN + derived state/PAN.
 */
export function parseOptionalGstin(
  value: unknown
): { ok: true; gstin: string | null; stateCode: string | null; stateName: string | null; pan: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return { ok: true, gstin: null, stateCode: null, stateName: null, pan: null };
  }
  const r = checkGstin(value);
  if (!r.valid) return { ok: false, error: r.error };
  return { ok: true, gstin: r.gstin, stateCode: r.stateCode, stateName: r.stateName, pan: r.pan };
}

/**
 * Validates a party/business GSTIN and reconciles it with the supplied state:
 * missing state is filled from the GSTIN; a conflicting state is rejected (place of supply
 * for B2B follows the GSTIN state).
 */
export function resolveGstinAndState(input: {
  gstin: unknown;
  state?: string | null;
  state_code?: string | null;
}):
  | { ok: true; gstin: string | null; state: string | null; state_code: string | null; pan: string | null }
  | { ok: false; error: string; code: 'INVALID_GSTIN' | 'GSTIN_STATE_MISMATCH' } {
  const parsed = parseOptionalGstin(input.gstin);
  if (!parsed.ok) return { ok: false, error: parsed.error, code: 'INVALID_GSTIN' };
  const state = input.state?.trim() || null;
  const stateCode = input.state_code?.trim() ? input.state_code.trim().padStart(2, '0') : null;
  if (!parsed.gstin || !parsed.stateCode) {
    return { ok: true, gstin: null, state, state_code: stateCode, pan: null };
  }
  if ((stateCode && stateCode !== parsed.stateCode) || !stateMatchesGstin(state, parsed.stateCode)) {
    return {
      ok: false,
      code: 'GSTIN_STATE_MISMATCH',
      error: `State does not match GSTIN: GSTIN ${parsed.gstin} is registered in ${parsed.stateName} (${parsed.stateCode}).`,
    };
  }
  return { ok: true, gstin: parsed.gstin, state: state || parsed.stateName, state_code: parsed.stateCode, pan: parsed.pan };
}

/** Compares a state name/code against the GSTIN state (case- and punctuation-insensitive). */
export function stateMatchesGstin(state: string | null | undefined, gstinStateCode: string): boolean {
  if (!state || !state.trim()) return true;
  const s = state.trim();
  if (/^\d{1,2}$/.test(s)) return s.padStart(2, '0') === gstinStateCode;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
  const expected = GST_STATE_NAMES[gstinStateCode];
  if (!expected) return true;
  const n = norm(s);
  return n === norm(expected) || (gstinStateCode === '26' && n === norm('Daman and Diu')) || (gstinStateCode === '37' && n === 'andhrapradesh');
}
