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
  if (host === 'wa.me') raw = decodeURIComponent(url.pathname.split('/')[1] ?? '');
  else if (host === 'api.whatsapp.com' && /^\/send\/?$/.test(url.pathname)) raw = url.searchParams.get('phone');
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
