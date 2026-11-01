import { createHmac, timingSafeEqual } from 'crypto';
import { storePhoneDigits, storePhonesMatch } from '@/lib/store/store-phone';

export { storePhoneDigits, storePhonesMatch };

export const STORE_CUSTOMER_COOKIE = 'khatario_store_cust';

/** Matches the store customer cookie's 30-day max age. */
const STORE_CUSTOMER_TTL_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  const key = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('JWT_SECRET is required for store customer sessions');
  return key;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(`store-customer:${payload}`).digest('hex');
}

export function signStoreCustomer(businessId: string, customerId: string): string {
  const exp = Math.floor(Date.now() / 1000) + STORE_CUSTOMER_TTL_SECONDS;
  const payload = `${businessId}.${customerId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function readStoreCustomer(token: string | undefined): {
  businessId: string;
  customerId: string;
} | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [businessId, customerId, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = sign(`${businessId}.${customerId}.${expRaw}`);
  try {
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return { businessId, customerId };
}
