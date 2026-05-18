import type { CustomerSurfaceSettings } from './types';
import { DEFAULT_CUSTOMER_SURFACE_SETTINGS } from './types';

export function mergeCustomerSurfaceSettings(
  raw: unknown
): CustomerSurfaceSettings {
  const base = { ...DEFAULT_CUSTOMER_SURFACE_SETTINGS };
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  const promoRaw = o.promo;
  let promo = base.promo!;
  if (promoRaw && typeof promoRaw === 'object') {
    const p = promoRaw as Record<string, unknown>;
    promo = {
      enabled: Boolean(p.enabled),
      title: typeof p.title === 'string' ? p.title : undefined,
      body: typeof p.body === 'string' ? p.body : undefined,
      image_url: typeof p.image_url === 'string' ? p.image_url : undefined,
      cta_label: typeof p.cta_label === 'string' ? p.cta_label : undefined,
      cta_url: typeof p.cta_url === 'string' ? p.cta_url : undefined,
      cta_phone: typeof p.cta_phone === 'string' ? p.cta_phone : undefined,
      cta_whatsapp: typeof p.cta_whatsapp === 'string' ? p.cta_whatsapp : undefined,
    };
  }
  return {
    promo,
    show_platform_ads:
      typeof o.show_platform_ads === 'boolean'
        ? o.show_platform_ads
        : base.show_platform_ads,
    notify_on_first_view:
      typeof o.notify_on_first_view === 'boolean'
        ? o.notify_on_first_view
        : base.notify_on_first_view,
  };
}
