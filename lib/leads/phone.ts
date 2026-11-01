/**
 * Lead phone numbers. A leaf module (no app imports) so lib/leads and lib/whatsapp can both use it.
 */

/** Digits with country code; a bare 10-digit Indian mobile gets 91. Null when it can't be a phone. */
export function normalizeLeadPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
