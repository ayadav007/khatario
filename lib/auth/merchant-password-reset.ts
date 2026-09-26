import bcrypt from 'bcryptjs';
import { query, queryOne } from '@/lib/db';
import { consumePlatformOtpPair, issuePlatformOtp, nationalPhone10 } from '@/lib/platform-public-otp';

const GENERIC =
  'If this phone and email match a Khatario account, we sent a WhatsApp code and an email code. Both are required.';

function phoneFormats(raw: string): string[] {
  const cleaned = raw.replace(/[^\d+]/g, '');
  const formats = [cleaned];
  if (cleaned.startsWith('+91')) formats.push(cleaned.substring(3));
  else if (cleaned.startsWith('91') && cleaned.length >= 12) formats.push(cleaned.substring(2));
  else if (cleaned.length === 10) {
    formats.push('+91' + cleaned);
    formats.push('91' + cleaned);
  }
  return [...new Set(formats)];
}

function normEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

async function findUserByPhone(rawPhone: string): Promise<{
  id: string;
  phone: string;
  accountEmail: string | null;
} | null> {
  for (const phone of phoneFormats(rawPhone)) {
    const row = await queryOne<{
      id: string;
      phone: string;
      user_email: string | null;
      business_email: string | null;
    }>(
      `SELECT u.id, u.phone, u.email AS user_email, b.email AS business_email
       FROM users u
       LEFT JOIN businesses b ON b.id = u.business_id
       WHERE u.phone = $1 AND COALESCE(u.is_active, true) = true`,
      [phone],
    );
    if (row) {
      const accountEmail = (row.user_email || row.business_email || '').trim().toLowerCase() || null;
      return { id: row.id, phone: row.phone, accountEmail };
    }
  }
  return null;
}

export async function requestMerchantPasswordReset(input: {
  phone: string;
  email: string;
}): Promise<{ ok: true; message: string; debugWhatsAppOtp?: string; debugEmailOtp?: string }> {
  const phone10 = nationalPhone10(input.phone);
  const email = normEmail(input.email);
  if (!phone10 || !email) {
    return { ok: true, message: GENERIC };
  }

  const user = await findUserByPhone(input.phone);
  if (!user?.accountEmail || user.accountEmail !== email) {
    return { ok: true, message: GENERIC };
  }

  const wa = await issuePlatformOtp('password_reset_wa', phone10);
  const em = await issuePlatformOtp('password_reset_email', phone10, { email });
  return {
    ok: true,
    message: GENERIC,
    ...(wa.debugOtp ? { debugWhatsAppOtp: wa.debugOtp } : {}),
    ...(em.debugOtp ? { debugEmailOtp: em.debugOtp } : {}),
  };
}

export async function completeMerchantPasswordReset(input: {
  phone: string;
  email: string;
  whatsappCode: string;
  emailCode: string;
  newPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  const phone10 = nationalPhone10(input.phone);
  const email = normEmail(input.email);
  if (!phone10 || !email) {
    return { ok: false, error: 'Enter a valid phone number and email' };
  }
  if (input.newPassword.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' };
  }
  if (!/^\d{6}$/.test(input.whatsappCode.trim()) || !/^\d{6}$/.test(input.emailCode.trim())) {
    return { ok: false, error: 'Enter both 6-digit codes' };
  }

  const user = await findUserByPhone(input.phone);
  if (!user?.accountEmail || user.accountEmail !== email) {
    return { ok: false, error: 'Invalid codes or account details' };
  }

  const pairOk = await consumePlatformOtpPair(phone10, input.whatsappCode, input.emailCode);
  if (!pairOk) {
    return { ok: false, error: 'Invalid or expired codes. Both the WhatsApp and email codes are required.' };
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  try {
    await query(
      `UPDATE users
       SET password_hash = $1,
           email = COALESCE(NULLIF(TRIM(email), ''), $2),
           auth_session_version = COALESCE(auth_session_version, 1) + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [passwordHash, email, user.id],
    );
  } catch {
    await query(
      `UPDATE users
       SET password_hash = $1,
           auth_session_version = COALESCE(auth_session_version, 1) + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [passwordHash, user.id],
    );
  }
  return { ok: true };
}
