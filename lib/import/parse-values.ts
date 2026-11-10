import { normalizePhoneOrNull } from '@/lib/utils/phone';
import type { DateOrder } from '@/lib/import/types';

export type { DateOrder };

export function normaliseKey(text: string): string {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseAmount(text: string): { amount: number; side: 'debit' | 'credit' | null } | null {
  let s = String(text ?? '').trim();
  if (!s) return { amount: 0, side: null };
  let side: 'debit' | 'credit' | null = null;
  const suffix = s.match(/\s*(dr|cr)\.?$/i);
  if (suffix) {
    side = suffix[1].toLowerCase() === 'dr' ? 'debit' : 'credit';
    s = s.slice(0, suffix.index).trim();
  }
  s = s.replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  const amount = Number(s);
  if (!Number.isFinite(amount)) return null;
  if (negative && side === null) side = 'credit';
  return { amount, side };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function fullYear(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

function buildDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDate(text: string, order: DateOrder): string | null {
  const s = String(text ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2}|\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi < 0) return null;
    return buildDate(fullYear(m[3]), mi + 1, Number(m[1]));
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return order === 'dmy' ? buildDate(fullYear(m[3]), b, a) : buildDate(fullYear(m[3]), a, b);
  }
  return null;
}

/** True for numeric day/month dates where both readings are valid and differ (01-04-2026). */
export function isAmbiguousDate(text: string): boolean {
  const m = String(text ?? '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a >= 1 && a <= 12 && b >= 1 && b <= 12 && a !== b;
}

/**
 * First valid number in the cell. Indian numbers with a +91 / 91 / 0 prefix come back as
 * the bare 10-digit number, so they match the same number written without the prefix.
 */
export function parsePhone(text: string): string | null {
  const parts = String(text ?? '').split(/[,;/\n]+/);
  for (const part of parts) {
    let digits = part.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    const n = normalizePhoneOrNull(digits);
    if (n) return n;
  }
  return null;
}

/** Strict check for column detection: one Indian mobile number and nothing else. */
export function looksLikePhone(text: string): boolean {
  const s = String(text ?? '').trim();
  if (!/^[\d\s+\-()]+$/.test(s)) return false;
  let digits = s.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits);
}

export function looksLikeGstin(text: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(text ?? '').trim().toUpperCase());
}

export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text ?? '').trim());
}

export function looksLikePincode(text: string): boolean {
  return /^[1-9][0-9]{5}$/.test(String(text ?? '').trim());
}

export function parseTaxRate(text: string): number | null {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(exempt(ed)?|nil|nil rated|zero)\b/.test(s) || s === '-') return 0;
  const m = s.match(/(\d+(?:\.\d+)?)\s*%?/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

export function parseBoolean(text: string): boolean | null {
  const s = normaliseKey(text);
  if (['yes', 'y', 'true', '1'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
}

const UNIT_ALIASES: Record<string, string[]> = {
  PCS: ['pcs', 'pc', 'piece', 'pieces', 'nos', 'no', 'number'],
  KG: ['kg', 'kgs', 'kilogram'],
  GM: ['g', 'gm', 'gram'],
  LTR: ['l', 'ltr', 'litre', 'liter'],
  ML: ['ml'],
  MTR: ['m', 'mtr', 'meter', 'metre'],
  BOX: ['box', 'boxes'],
  DOZ: ['dz', 'doz', 'dozen'],
  PKT: ['pkt', 'pack', 'packet'],
  BAG: ['bag', 'bags'],
  SET: ['set', 'sets'],
  PRS: ['pair', 'pairs', 'pr'],
};
/** The units resolveUnit can answer, offered when a unit needs a match. */
export const UNIT_CODES = Object.keys(UNIT_ALIASES);
const UNIT_BY_ALIAS = new Map<string, string>();
for (const [unit, aliases] of Object.entries(UNIT_ALIASES)) for (const a of aliases) UNIT_BY_ALIAS.set(a, unit);

export function resolveUnit(text: string): string | null {
  return UNIT_BY_ALIAS.get(normaliseKey(text)) ?? null;
}
