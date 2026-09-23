import { createHmac, timingSafeEqual } from 'crypto';

export const STORE_CUSTOMER_COOKIE = 'khatario_store_cust';

function secret(): string {
  return process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET || 'khatario-store-dev';
}

export function signStoreCustomer(businessId: string, customerId: string): string {
  const payload = `${businessId}.${customerId}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function readStoreCustomer(token: string | undefined): {
  businessId: string;
  customerId: string;
} | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [businessId, customerId, sig] = parts;
  const expected = createHmac('sha256', secret()).update(`${businessId}.${customerId}`).digest('hex');
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
