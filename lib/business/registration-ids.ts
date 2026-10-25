/** MSME (Udyam), TAN and the signing director's DIN. Certificates are stored separately. */

export const REGISTRATION_KINDS = ['msme', 'tan', 'din'] as const;
export type RegistrationKind = (typeof REGISTRATION_KINDS)[number];

export const REGISTRATION_NUMBER_FIELD: Record<RegistrationKind, 'udyam_number' | 'tan' | 'din'> = {
  msme: 'udyam_number',
  tan: 'tan',
  din: 'din',
};

export const REGISTRATION_MAX_BYTES = 5 * 1024 * 1024;

const UDYAM = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const TAN = /^[A-Z]{4}\d{5}[A-Z]$/;
const DIN = /^\d{8}$/;

export function isRegistrationKind(value: unknown): value is RegistrationKind {
  return typeof value === 'string' && (REGISTRATION_KINDS as readonly string[]).includes(value);
}

export type ParsedRegistrationNumber =
  | { ok: true; value: string | null }
  | { ok: false; error: string; code: 'INVALID_UDYAM' | 'INVALID_TAN' | 'INVALID_DIN' };

function tidy(value: unknown): string {
  if (value == null) return '';
  return String(value).trim().toUpperCase().replace(/\s+/g, '');
}

/** Empty clears the number. A value must match the published format. */
export function parseRegistrationNumber(kind: RegistrationKind, value: unknown): ParsedRegistrationNumber {
  const raw = tidy(value);
  if (!raw) return { ok: true, value: null };

  if (kind === 'msme') {
    const compact = raw.replace(/-/g, '');
    const formatted = /^UDYAM[A-Z]{2}\d{9}$/.test(compact)
      ? `UDYAM-${compact.slice(5, 7)}-${compact.slice(7, 9)}-${compact.slice(9)}`
      : raw;
    if (!UDYAM.test(formatted)) {
      return { ok: false, code: 'INVALID_UDYAM', error: 'Udyam number looks like UDYAM-KA-00-0000000' };
    }
    return { ok: true, value: formatted };
  }

  if (kind === 'tan') {
    if (!TAN.test(raw)) {
      return { ok: false, code: 'INVALID_TAN', error: 'TAN looks like BLRA12345B' };
    }
    return { ok: true, value: raw };
  }

  if (!DIN.test(raw)) {
    return { ok: false, code: 'INVALID_DIN', error: 'DIN is 8 digits' };
  }
  return { ok: true, value: raw };
}

export type RegistrationFileType = { mime: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' };

/** Trust the file bytes, not the browser's content type. */
export function sniffRegistrationFile(bytes: Uint8Array): RegistrationFileType | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { mime: 'application/pdf' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg' };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: 'image/png' };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { mime: 'image/webp' };
  }
  return null;
}

export function safeRegistrationFileName(name: unknown, mime: RegistrationFileType['mime']): string {
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const base = typeof name === 'string' ? name : '';
  const cleaned = base.replace(/[^\w.\- ()]+/g, '').replace(/^\.+/, '').slice(0, 120).trim();
  if (!cleaned) return `certificate.${ext}`;
  return cleaned;
}
