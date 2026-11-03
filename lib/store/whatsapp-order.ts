/** WhatsApp ordering helpers. Pure and client-safe. */

/**
 * The WhatsApp number in a store's WhatsApp link, as 12 digits with the country code: `wa.me/<n>` or
 * `api.whatsapp.com/send?phone=<n>`. A 10-digit Indian mobile gets 91 in front; anything that is not an
 * Indian mobile gives null (so a link to some other site, or a short number, never builds an order link).
 */
export function whatsappNumber(link: string): string | null {
  if (typeof link !== 'string') return null;
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');
  let raw: string | null = null;
  if (host === 'wa.me') {
    // A malformed escape (`%E0%A4%A`, a lone `%`) must never throw: this runs while the page renders.
    try {
      raw = decodeURIComponent(url.pathname.split('/')[1] ?? '');
    } catch {
      return null;
    }
  } else if (host === 'api.whatsapp.com' && /^\/send\/?$/.test(url.pathname)) raw = url.searchParams.get('phone');
  if (!raw) return null;
  return indianMobile(raw);
}

/** `9845012345`, `+91 98450 12345` or `919845012345` as `919845012345`; null for anything else. */
export function indianMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  return null;
}

export interface WhatsappOrderLine {
  name: string;
  /** The pack the shopper chose ("1 L"), when the product has packs. */
  pack?: string;
  quantity: number;
  price: number;
}

/** Most lines the message lists; the rest become "…and N more items". */
const MAX_LINES = 30;
/** The message may be at most this long once encoded, so the whole link stays under 2,000 characters. */
const MAX_ENCODED = 1960;

function clip(value: string, max: number): string {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

function rupees(amount: number): string {
  return `₹${(Math.round(amount * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * The message a shopper sends the store from the cart: one line per product with quantity, pack and amount, the total
 * and (only for a full 6-digit one) the delivery pincode. Carts longer than 30 lines are cut with "…and N more items",
 * and further if the long names would push the encoded link past 2,000 characters; the total still counts every line.
 */
export function whatsappOrderText(storeName: string, lines: WhatsappOrderLine[], pincode?: string): string {
  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const rows = lines.map((l) => {
    const name = clip(l.name, 60);
    const pack = l.pack ? clip(l.pack, 30) : '';
    return `${l.quantity} × ${name}${pack ? ` (${pack})` : ''} – ${rupees(l.price * l.quantity)}`;
  });
  const pin = pincode && /^\d{6}$/.test(pincode.trim()) ? pincode.trim() : '';
  const build = (shown: number): string => {
    const out = [`Hi ${clip(storeName, 40)}, I'd like to order:`, ...rows.slice(0, shown)];
    const left = rows.length - shown;
    if (left > 0) out.push(`…and ${left} more ${left === 1 ? 'item' : 'items'}`);
    out.push(`Total: ${rupees(total)}`);
    if (pin) out.push(`Deliver to: ${pin}`);
    return out.join('\n');
  };
  let shown = Math.min(rows.length, MAX_LINES);
  let text = build(shown);
  while (shown > 0 && encodeURIComponent(text).length > MAX_ENCODED) {
    shown -= 1;
    text = build(shown);
  }
  return text;
}

/** `https://wa.me/<number>?text=<message>`, the message fully encoded (`&`, `#`, `+`, newlines, Hindi). */
export function whatsappOrderUrl(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
