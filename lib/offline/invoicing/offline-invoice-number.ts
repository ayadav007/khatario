import { Preferences } from '@capacitor/preferences';

const DEVICE_LABEL_KEY = 'khatario_offline_device_label';
const SEQ_PREFIX = 'khatario_offline_invoice_seq_';

/** Pattern: TMP-{DEVICE}-{SEQ} e.g. TMP-ANDROID1-1001 */
export const OFFLINE_INVOICE_PREFIX = 'TMP';

export function isOfflineTempInvoiceNumber(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^TMP-[A-Z0-9]+-\d+$/i.test(value.trim());
}

export async function getOfflineDeviceLabel(): Promise<string> {
  if (typeof window === 'undefined') return 'WEB';
  try {
    const existing = await Preferences.get({ key: DEVICE_LABEL_KEY });
    if (existing.value) return existing.value;
    const label =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
        : `D${Date.now().toString(36).slice(-4).toUpperCase()}`;
    await Preferences.set({ key: DEVICE_LABEL_KEY, value: label });
    return label;
  } catch {
    return 'WEB';
  }
}

async function nextOfflineSequence(deviceLabel: string): Promise<number> {
  const key = `${SEQ_PREFIX}${deviceLabel}`;
  try {
    const current = await Preferences.get({ key });
    const next = (Number(current.value ?? 1000) || 1000) + 1;
    await Preferences.set({ key, value: String(next) });
    return next;
  } catch {
    return Date.now() % 100000;
  }
}

/** Generates a device-scoped temporary invoice reference for offline billing. */
export async function generateOfflineInvoiceReference(): Promise<{
  offlineReferenceNumber: string;
  deviceLabel: string;
}> {
  const deviceLabel = await getOfflineDeviceLabel();
  const seq = await nextOfflineSequence(deviceLabel);
  return {
    deviceLabel,
    offlineReferenceNumber: `${OFFLINE_INVOICE_PREFIX}-${deviceLabel}-${seq}`,
  };
}
