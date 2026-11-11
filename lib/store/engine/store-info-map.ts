import { indianMobile, whatsappNumber } from '@/lib/store/whatsapp-order';
import { formatStoreTime, storeDayOf, type StoreHours } from '@/lib/store/store-hours';

// Client-safe and pure.

export type StoreInfoInput = {
  storeName: string;
  /** The section's heading setting; empty means the store name. */
  heading: string;
  phone: string | null | undefined;
  address: string | null | undefined;
  hours: StoreHours | null | undefined;
  /** `theme.settings.social.whatsapp` (a sanitised link, or empty). */
  whatsapp: string | null | undefined;
  showHours: boolean;
  showAddress: boolean;
  showButtons: boolean;
};

export type StoreInfoView = {
  heading: string;
  hours: StoreHours | null;
  address: string | null;
  callHref: string | null;
  whatsappHref: string | null;
  directionsHref: string | null;
};

/** `tel:` link: an Indian mobile gets +91; any other 7-15 digit number is kept as typed (with its +). */
function callLink(raw: string): string | null {
  const mobile = indianMobile(raw);
  if (mobile) return `tel:+${mobile}`;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${raw.trim().startsWith('+') ? '+' : ''}${digits}`;
}

/** What the Store info card shows. Parts with no data (or switched off) are null; null when nothing is left. */
export function storeInfoView(input: StoreInfoInput): StoreInfoView | null {
  const address = input.address?.trim() || null;
  const phone = input.phone?.trim() || null;
  const wa = input.whatsapp ? whatsappNumber(input.whatsapp) : null;
  const view: StoreInfoView = {
    heading: input.heading.trim() || input.storeName,
    hours: input.showHours ? input.hours ?? null : null,
    address: input.showAddress ? address : null,
    callHref: input.showButtons && phone ? callLink(phone) : null,
    whatsappHref: input.showButtons && wa ? `https://wa.me/${wa}` : null,
    directionsHref:
      input.showButtons && address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
        : null,
  };
  const any = view.hours || view.address || view.callHref || view.whatsappHref || view.directionsHref;
  return any ? view : null;
}

/** "Open today 7 AM – 10 PM" or "Closed today", for the weekday it is in India. */
export function todayHoursLabel(hours: StoreHours, now: Date): string {
  const today = hours[storeDayOf(now)];
  return today ? `Open today ${formatStoreTime(today.open)} – ${formatStoreTime(today.close)}` : 'Closed today';
}
