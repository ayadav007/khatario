/** Normalize partner referral codes from ?ref= or manual entry. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (code.length < 2 || code.length > 32) return null;
  return code;
}

export function buildPartnerSignupUrl(origin: string, referralCode: string): string {
  const code = normalizeReferralCode(referralCode);
  if (!code) return `${origin.replace(/\/$/, '')}/signup`;
  const base = origin.replace(/\/$/, '');
  return `${base}/signup?ref=${encodeURIComponent(code)}`;
}
