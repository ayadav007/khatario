import crypto from 'crypto';

export {
  KIOSK_SESSION_PREFIX,
  isKioskSessionToken,
  isKioskSessionApiAllowed,
} from '@/lib/employee-portal/ess-api-allowlist';

/**
 * Attendance kiosk devices. A manager signed in to Khatario registers a shared tablet, which
 * stores a signed, HttpOnly device cookie for that business. Kiosk logins (employee code only)
 * are accepted only from a registered device, and give a short session that can only punch
 * attendance. Bumping `kiosk_device_generation` in the HR portal settings revokes every device.
 */

export const KIOSK_DEVICE_COOKIE = 'khatario_kiosk_device';
export const KIOSK_SESSION_MINUTES = 5;
const DEVICE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function deviceSecret(): string {
  const secret = process.env.KIOSK_DEVICE_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for kiosk devices');
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', deviceSecret()).update(`kiosk-device:${payload}`).digest('base64url');
}

export function createKioskDeviceToken(businessId: string, generation: number): string {
  const payload = Buffer.from(
    JSON.stringify({ b: businessId, g: generation, n: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** True when the cookie is a device token this server signed for `businessId` at `generation`. */
export function verifyKioskDeviceToken(
  token: string | null | undefined,
  businessId: string,
  generation: number
): boolean {
  if (!token) return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { b?: string; g?: number };
    return data.b === businessId && data.g === generation;
  } catch {
    return false;
  }
}

export function kioskDeviceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: DEVICE_MAX_AGE_SECONDS,
  };
}
