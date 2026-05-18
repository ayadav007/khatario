/**
 * Phone number normalization and validation utilities.
 * Storage format: international digits only, no + (e.g. 917769870606 for WhatsApp / E.164-style).
 */

/** Dial codes for the country selector (India first). Parsing uses longest-code-first matching. */
export const PHONE_DIAL_CODE_OPTIONS: { code: string; label: string }[] = [
  { code: '91', label: 'India (+91)' },
  { code: '971', label: 'UAE (+971)' },
  { code: '966', label: 'Saudi Arabia (+966)' },
  { code: '880', label: 'Bangladesh (+880)' },
  { code: '977', label: 'Nepal (+977)' },
  { code: '94', label: 'Sri Lanka (+94)' },
  { code: '92', label: 'Pakistan (+92)' },
  { code: '65', label: 'Singapore (+65)' },
  { code: '60', label: 'Malaysia (+60)' },
  { code: '62', label: 'Indonesia (+62)' },
  { code: '61', label: 'Australia (+61)' },
  { code: '44', label: 'UK (+44)' },
  { code: '49', label: 'Germany (+49)' },
  { code: '33', label: 'France (+33)' },
  { code: '81', label: 'Japan (+81)' },
  { code: '86', label: 'China (+86)' },
  { code: '1', label: 'US / Canada (+1)' },
];

const DIAL_CODES_LONGEST_FIRST = [...PHONE_DIAL_CODE_OPTIONS].sort(
  (a, b) => b.code.length - a.code.length
);

const DEFAULT_DIAL = '91';

/**
 * Concatenate country calling code and national number for DB / WhatsApp (digits only, no +).
 */
export function toWhatsAppStyleDigits(dialCode: string, nationalDigits: string): string {
  const d = dialCode.replace(/\D/g, '');
  const n = nationalDigits.replace(/\D/g, '');
  if (!d && !n) return '';
  return `${d}${n}`;
}

/**
 * Split a stored full-digit string into dial code + national number for the UI.
 * Unknown / legacy 10-digit Indian numbers default to +91.
 */
export function splitStoredPhoneForInput(stored: string): {
  dialCode: string;
  nationalNumber: string;
} {
  const digits = (stored || '').replace(/\D/g, '');
  if (!digits) {
    return { dialCode: DEFAULT_DIAL, nationalNumber: '' };
  }

  for (const { code } of DIAL_CODES_LONGEST_FIRST) {
    if (digits.startsWith(code) && digits.length > code.length) {
      return { dialCode: code, nationalNumber: digits.slice(code.length) };
    }
  }

  if (digits.length === 10) {
    return { dialCode: DEFAULT_DIAL, nationalNumber: digits };
  }

  return { dialCode: DEFAULT_DIAL, nationalNumber: digits };
}

/**
 * Normalize phone number to digits only (no +, spaces, dashes).
 * Accepts various formats: +919876543210, 919876543210, 9876543210 (treated as valid 10-digit national elsewhere).
 * Returns empty string if invalid length for typical international use.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';

  const digits = phone.replace(/\D/g, '');

  if (digits.length < 9 || digits.length > 15) {
    return '';
  }

  return digits;
}

/**
 * Normalize for API persistence: digits only, or null if empty/invalid.
 * Coerces non-strings (e.g. JSON number) so values are not dropped by mistake.
 * E.164 max length 15; minimum kept at 8 to avoid false positives on typos.
 */
export function normalizePhoneOrNull(input: unknown): string | null {
  if (input == null) return null;
  const s = typeof input === 'string' ? input.trim() : String(input).trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return normalized.length >= 9 && normalized.length <= 15;
}

export function parseRecipientLine(line: string): { phone: string; name?: string } | null {
  if (!line || !line.trim()) return null;

  const parts = line.split(',').map((p) => p.trim());

  if (parts.length === 2) {
    const part1 = normalizePhone(parts[0]);
    const part2 = normalizePhone(parts[1]);

    if (part1 && part2) {
      return { phone: part1, name: parts[1] };
    } else if (part1) {
      return { phone: part1, name: parts[1] || undefined };
    } else if (part2) {
      return { phone: part2, name: parts[0] || undefined };
    }
  }

  const normalized = normalizePhone(line);
  if (normalized) {
    return { phone: normalized };
  }

  return null;
}
