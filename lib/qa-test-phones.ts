/**
 * Reserved QA test phones (staging only). Numbers listed in QA_TEST_PHONES get the signup OTP
 * on screen like OTP_DEBUG_PHONES, and no WhatsApp message is ever sent to them, so test
 * accounts on staging can use made-up numbers without messaging whoever really owns them.
 * Always off on the production host. "*" is not accepted here.
 */

function isProductionAppUrl(appUrl: string): boolean {
  try {
    const host = new URL(appUrl).hostname.toLowerCase();
    return host === 'khatario.com' || host === 'www.khatario.com' || host === 'app.khatario.com';
  } catch {
    return false;
  }
}

function last10(input: string): string | null {
  const digits = String(input || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function isQaTestPhone(
  phone: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const appUrl = env.NEXT_PUBLIC_APP_URL || '';
  if (isProductionAppUrl(appUrl)) return false;
  if (env.SIGNUP_DEBUG !== 'true' && !appUrl.includes('staging.')) return false;
  // Group and linked-device ids are never test phones.
  if (/@(g\.us|lid|broadcast|newsletter)$/.test(String(phone || ''))) return false;
  const target = last10(String(phone || '').split('@')[0].split(':')[0]);
  if (!target) return false;
  return (env.QA_TEST_PHONES || '')
    .split(',')
    .map((p) => last10(p.trim()))
    .some((p) => p === target);
}

/** Logs a WhatsApp send that was dropped because the recipient is a QA test phone. */
export function logSuppressedQaSend(channel: string, to: string, preview?: string): string {
  const id = `qa-suppressed-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  // console.error: production builds strip console.log, and this line is the QA evidence that nothing went out.
  console.error(`[qa-test-phone] ${channel} to ${to} not sent (${id})${preview ? `: ${preview.slice(0, 120)}` : ''}`);
  return id;
}
