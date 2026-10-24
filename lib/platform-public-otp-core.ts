import { createHash } from 'crypto';

export type PlatformOtpPurpose =
  | 'signup'
  | 'demo_booking'
  | 'password_reset_wa'
  | 'password_reset_email';

export function nationalPhone10(input: string): string | null {
  const digits = String(input || '').replace(/\D/g, '');
  const last = digits.slice(-10);
  return last.length === 10 ? last : null;
}

function isProductionAppUrl(appUrl: string): boolean {
  try {
    const host = new URL(appUrl).hostname.toLowerCase();
    return host === 'khatario.com' || host === 'www.khatario.com' || host === 'app.khatario.com';
  } catch {
    return false;
  }
}

/**
 * Whether an OTP may be echoed back to the client (or a fixed test code accepted) for this phone.
 * Requires a debug environment (SIGNUP_DEBUG=true or a staging URL), the phone to be listed in
 * OTP_DEBUG_PHONES (comma-separated; "*" allows any, meant for local e2e), and is always false
 * on the production host.
 */
export function otpDebugAllowedFor(
  phone: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const appUrl = env.NEXT_PUBLIC_APP_URL || '';
  if (isProductionAppUrl(appUrl)) return false;
  if (env.SIGNUP_DEBUG !== 'true' && !appUrl.includes('staging.')) return false;
  const allowed = (env.OTP_DEBUG_PHONES || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (allowed.includes('*')) return true;
  const target = nationalPhone10(phone);
  return !!target && allowed.some((p) => nationalPhone10(p) === target);
}

export function hashPlatformOtp(
  purpose: PlatformOtpPurpose,
  phone: string,
  code: string,
  pepper: string,
): string {
  return createHash('sha256').update(`${pepper}:${purpose}:${phone}:${code}`).digest('hex');
}
