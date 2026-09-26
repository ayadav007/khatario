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

export function hashPlatformOtp(
  purpose: PlatformOtpPurpose,
  phone: string,
  code: string,
  pepper: string,
): string {
  return createHash('sha256').update(`${pepper}:${purpose}:${phone}:${code}`).digest('hex');
}
