/**
 * A small in-process cache in front of isKnownNumber for the inbound message path, which asks on
 * every live message from a number with no open lead (customers, suppliers and staff chatting are the
 * common case). Only "known" answers are kept: an unknown number opens a lead on that message, so its
 * later messages join the lead and never ask again, and not caching "unknown" means a number staff
 * add as a customer stops opening Direct leads at once. A number that stops being known can still be
 * treated as known for up to ten minutes, which only means its next message opens no Direct lead.
 * Other callers use isKnownNumber directly and always get a fresh answer.
 */
import { isKnownNumber } from '@/lib/whatsapp/lead-sources';

export const KNOWN_NUMBER_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

/** `${businessId}:${last10}` -> when the entry expires. */
const known = new Map<string, number>();

export async function isKnownNumberCached(businessId: string, phone: string): Promise<boolean> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return isKnownNumber(businessId, phone);
  const key = `${businessId}:${digits.slice(-10)}`;
  const expires = known.get(key);
  if (expires !== undefined) {
    if (expires > Date.now()) return true;
    known.delete(key);
  }
  const isKnown = await isKnownNumber(businessId, phone);
  if (isKnown) {
    // Map keeps insertion order, so the first key is the oldest entry.
    if (known.size >= MAX_ENTRIES) known.delete(known.keys().next().value!);
    known.set(key, Date.now() + KNOWN_NUMBER_TTL_MS);
  }
  return isKnown;
}

/** For tests. */
export function clearKnownNumberCache(): void {
  known.clear();
}
