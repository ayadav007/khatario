import { isCapacitorNative } from '@/lib/capacitor/platform';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

export type PickedDeviceCustomer = {
  name: string;
  phone: string;
  email: string;
};

type WebContactPicker = {
  select: (
    properties: string[],
    options?: { multiple?: boolean }
  ) => Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>>;
};

function webContactPicker(): WebContactPicker | null {
  if (typeof navigator === 'undefined') return null;
  const contacts = (navigator as Navigator & { contacts?: WebContactPicker }).contacts;
  if (!contacts || typeof contacts.select !== 'function') return null;
  return contacts;
}

export function canPickDeviceCustomer(): boolean {
  return isCapacitorNative() || webContactPicker() != null;
}

export function phonesLikelyMatch(a?: string | null, b?: string | null): boolean {
  const da = (a || '').replace(/\D/g, '');
  const db = (b || '').replace(/\D/g, '');
  if (da.length < 8 || db.length < 8) return false;
  if (da === db) return true;
  const ta = da.slice(-10);
  const tb = db.slice(-10);
  return ta.length >= 8 && ta === tb;
}

function isPickerCancel(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = String(e?.code || '');
  const message = String(e?.message || '').toLowerCase();
  return code.includes('0006') || message.includes('cancel') || message.includes('user denied');
}

function firstPhone(values: Array<{ type?: string; value?: string }> | undefined): string {
  if (!values?.length) return '';
  const mobile = values.find((p) => /mobile|cell/i.test(p.type || '') && p.value);
  const raw = (mobile?.value || values.find((p) => p.value)?.value || '').trim();
  return normalizePhoneOrNull(raw) || raw.replace(/\D/g, '');
}

export async function pickDeviceCustomer(): Promise<PickedDeviceCustomer | null> {
  if (isCapacitorNative()) {
    const { Contacts } = await import('@capacitor/contacts');
    try {
      const contact = await Contacts.pickContact();
      const name =
        contact.displayName?.trim() ||
        contact.name?.formatted?.trim() ||
        [contact.name?.givenName, contact.name?.middleName, contact.name?.familyName]
          .filter(Boolean)
          .join(' ')
          .trim();
      return {
        name,
        phone: firstPhone(contact.phoneNumbers),
        email: (contact.emails?.find((e) => e.value)?.value || '').trim(),
      };
    } catch (err) {
      if (isPickerCancel(err)) return null;
      throw err;
    }
  }

  const picker = webContactPicker();
  if (!picker) {
    throw new Error('Contact picker is only available in the Khatario Android app.');
  }

  try {
    const [contact] = await picker.select(['name', 'tel', 'email'], { multiple: false });
    if (!contact) return null;
    const tel = contact.tel?.[0] || '';
    return {
      name: (contact.name?.[0] || '').trim(),
      phone: normalizePhoneOrNull(tel) || tel.replace(/\D/g, ''),
      email: (contact.email?.[0] || '').trim(),
    };
  } catch (err) {
    if (isPickerCancel(err)) return null;
    throw err;
  }
}
