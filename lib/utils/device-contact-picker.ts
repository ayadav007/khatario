/**
 * Web Contact Picker API — mainly Chrome on Android. Opens the system address book.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Contact_Picker_API
 */

import { isValidPhone, normalizePhone } from './phone';

function asStringArray(x: unknown): string[] {
  if (x == null) return [];
  if (Array.isArray(x)) {
    return x.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof x === 'string' && x.trim()) return [x.trim()];
  return [];
}

function firstValidPhone(tels: string[]): string {
  for (const t of tels) {
    const n = normalizePhone(t);
    if (n && isValidPhone(n)) {
      return n;
    }
  }
  return '';
}

export function isDeviceContactPickerAvailable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const n = navigator as Navigator & { contacts?: { select?: unknown } };
  return typeof n.contacts?.select === 'function';
}

/**
 * @returns Picked name/phone/email, or `null` if the user cancelled or the API failed.
 * If the contact has no usable phone, returns `{ name, email, phone: '' }` so the UI can show a message.
 */
export async function pickOneContactFromDevice(): Promise<{
  name: string;
  phone: string;
  email: string;
} | null> {
  const nav = navigator as Navigator & {
    contacts: {
      getProperties: () => Promise<string[]>;
      select: (properties: string[], options?: { multiple?: boolean }) => Promise<unknown[]>;
    };
  };

  if (!nav.contacts || typeof nav.contacts.select !== 'function') {
    return null;
  }

  const available = await nav.contacts.getProperties();
  const want = (['name', 'tel', 'email'] as const).filter((p) => available.includes(p));
  if (want.length === 0) {
    return null;
  }

  const result = (await nav.contacts.select([...want], { multiple: false })) as unknown;
  if (!result || !Array.isArray(result) || result.length === 0) {
    return null;
  }

  const raw = result[0] as {
    name?: string[] | string;
    tel?: string[] | string;
    email?: string[] | string;
  };

  const names = asStringArray(raw.name);
  const tels = asStringArray(raw.tel);
  const emails = asStringArray(raw.email);
  const name = names[0] || names.join(' ') || '';
  const email = emails[0] || '';
  const phone = firstValidPhone(tels);

  return { name, email, phone };
}
