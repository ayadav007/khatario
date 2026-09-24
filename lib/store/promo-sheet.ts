export type StorePromoFrequency =
  | 'every_visit'
  | 'once_per_session'
  | 'once_per_day'
  | 'until_dismissed';

export type StorePromoCtaAction = 'shop' | 'url' | 'whatsapp' | 'none';

export interface StorePromoSheetConfig {
  enabled: boolean;
  version: string;
  title: string;
  body: string;
  image_url: string;
  background_color: string;
  text_color: string;
  button_color: string;
  button_text_color: string;
  cta_label: string;
  cta_action: StorePromoCtaAction;
  cta_url: string;
  coupon_code: string;
  frequency: StorePromoFrequency;
  delay_ms: number;
  start_at: string | null;
  end_at: string | null;
  dismissible: boolean;
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FREQUENCIES: StorePromoFrequency[] = [
  'every_visit',
  'once_per_session',
  'once_per_day',
  'until_dismissed',
];
const ACTIONS: StorePromoCtaAction[] = ['shop', 'url', 'whatsapp', 'none'];
const LEGACY_ACTIONS = new Set(['checkout', 'cart']);

export const DEFAULT_STORE_PROMO: StorePromoSheetConfig = {
  enabled: false,
  version: '1',
  title: '',
  body: '',
  image_url: '',
  background_color: '#ffffff',
  text_color: '#111827',
  button_color: '#16a34a',
  button_text_color: '#ffffff',
  cta_label: 'Shop now',
  cta_action: 'shop',
  cta_url: '',
  coupon_code: '',
  frequency: 'once_per_day',
  delay_ms: 400,
  start_at: null,
  end_at: null,
  dismissible: true,
};

function clip(s: unknown, max: number): string {
  return String(s ?? '').trim().slice(0, max);
}

function clipMediaUrl(value: unknown): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (v.startsWith('data:image/')) return v.slice(0, 1_800_000);
  return v.slice(0, 2000);
}

function hex(value: unknown, fallback: string): string {
  const v = String(value ?? '').trim();
  return HEX.test(v) ? (v.length === 4
    ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase()
    : v.toLowerCase()) : fallback;
}

function isoOrNull(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function normalizePromoCtaAction(raw: unknown): StorePromoCtaAction {
  if (LEGACY_ACTIONS.has(String(raw))) return 'shop';
  if (ACTIONS.includes(raw as StorePromoCtaAction)) return raw as StorePromoCtaAction;
  return DEFAULT_STORE_PROMO.cta_action;
}

export function sanitizeStorePromoSheet(raw: unknown): StorePromoSheetConfig {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const delay = Number(src.delay_ms);
  const frequency = FREQUENCIES.includes(src.frequency as StorePromoFrequency)
    ? (src.frequency as StorePromoFrequency)
    : DEFAULT_STORE_PROMO.frequency;
  const cta_action = normalizePromoCtaAction(src.cta_action);
  let cta_label = clip(src.cta_label, 40) || DEFAULT_STORE_PROMO.cta_label;
  if (/^(cart|checkout)$/i.test(cta_label.trim())) {
    cta_label = DEFAULT_STORE_PROMO.cta_label;
  }
  return {
    enabled: src.enabled === true,
    version: clip(src.version, 64) || String(Date.now()),
    title: clip(src.title, 80),
    body: clip(src.body, 400),
    image_url: clipMediaUrl(src.image_url),
    background_color: hex(src.background_color, DEFAULT_STORE_PROMO.background_color),
    text_color: hex(src.text_color, DEFAULT_STORE_PROMO.text_color),
    button_color: hex(src.button_color, DEFAULT_STORE_PROMO.button_color),
    button_text_color: hex(src.button_text_color, DEFAULT_STORE_PROMO.button_text_color),
    cta_label,
    cta_action,
    cta_url: clip(src.cta_url, 2000),
    coupon_code: clip(src.coupon_code, 64).toUpperCase(),
    frequency,
    delay_ms: Number.isFinite(delay) ? Math.min(8000, Math.max(0, Math.round(delay))) : 400,
    start_at: isoOrNull(src.start_at),
    end_at: isoOrNull(src.end_at),
    dismissible: src.dismissible !== false,
  };
}

export function isStorePromoActive(
  promo: StorePromoSheetConfig,
  now = new Date(),
): boolean {
  if (!promo.enabled) return false;
  if (!promo.title && !promo.body && !promo.image_url) return false;
  if (promo.start_at && now < new Date(promo.start_at)) return false;
  if (promo.end_at && now > new Date(promo.end_at)) return false;
  return true;
}

export function storePromoStorageKey(subdomain: string, version: string): string {
  return `khatario-store-promo:${subdomain}:${version}`;
}

export function promoSheetFingerprint(promo: StorePromoSheetConfig): string {
  const { version: _version, ...rest } = promo;
  return JSON.stringify(rest);
}

export function nextPromoSheetVersion(
  previous: StorePromoSheetConfig,
  next: StorePromoSheetConfig,
): string {
  return promoSheetFingerprint(previous) === promoSheetFingerprint(next)
    ? previous.version || '1'
    : String(Date.now());
}

export function shouldShowStorePromo(input: {
  frequency: StorePromoFrequency;
  stored: string | null;
  now?: number;
}): boolean {
  if (input.frequency === 'every_visit') return true;
  if (!input.stored) return true;
  if (input.frequency === 'until_dismissed') return false;
  if (input.frequency === 'once_per_session') return input.stored !== 'session';
  if (input.frequency === 'once_per_day') {
    const then = Number(input.stored);
    if (!Number.isFinite(then)) return true;
    const now = input.now ?? Date.now();
    return now - then > 24 * 60 * 60 * 1000;
  }
  return true;
}
