import { GST_STATE_NAMES } from '@/lib/tax/gstin';

/** GST state numbers that are not current states or union territories for party addresses. */
const EXCLUDED_CODES = new Set(['25', '28', '97', '99']);

/** Two-letter postal codes mapped to GST state numbers. */
const POSTAL_CODES: Record<string, string> = {
  JK: '01', HP: '02', PB: '03', CH: '04', UK: '05', UT: '05', HR: '06', DL: '07', RJ: '08',
  UP: '09', BR: '10', SK: '11', AR: '12', NL: '13', MN: '14', MZ: '15', TR: '16', ML: '17',
  AS: '18', WB: '19', JH: '20', OD: '21', OR: '21', CG: '22', MP: '23', GJ: '24', DD: '26',
  DN: '26', MH: '27', KA: '29', GA: '30', LD: '31', KL: '32', TN: '33', PY: '34', AN: '35',
  TS: '36', TG: '36', AP: '37', LA: '38',
};

function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BY_NAME = new Map<string, string>();
for (const [code, name] of Object.entries(GST_STATE_NAMES)) {
  if (!EXCLUDED_CODES.has(code)) BY_NAME.set(squash(name), code);
}

/**
 * Resolve a state from its full name, a two-letter code (MH) or the GST number (27),
 * ignoring case, spacing and punctuation.
 */
export function resolveState(text: string): { state: string; state_code: string } | null {
  const key = squash(String(text ?? ''));
  if (!key) return null;
  let code: string | undefined;
  if (/^\d{1,2}$/.test(key)) code = key.padStart(2, '0');
  else code = BY_NAME.get(key) ?? POSTAL_CODES[key.toUpperCase()];
  if (!code || EXCLUDED_CODES.has(code) || !GST_STATE_NAMES[code]) return null;
  return { state: GST_STATE_NAMES[code], state_code: code };
}
