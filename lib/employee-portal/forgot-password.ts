import { createHmac, randomInt } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendWhatsAppMessage, getWhatsAppStatus } from '@/lib/whatsapp';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { updateEmployeePortalPassword } from '@/lib/employee-portal/password';

const OTP_TTL_MINUTES = 10;
/** Wrong codes per employee (from any IP) before the live code is burned. */
const OTP_GUESS_LIMIT = 5;
const OTP_GUESS_WINDOW_MS = 15 * 60 * 1000;

const GENERIC_SENT_MESSAGE = 'If an account exists for this phone number, a verification code will be sent.';

export function generatePortalOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

/** Codes are stored as an HMAC, never in plain text. */
function hashPortalOtp(employeeId: string, code: string): string {
  const key = process.env.JWT_SECRET;
  if (!key) throw new Error('JWT_SECRET is required');
  return 'h1:' + createHmac('sha256', key).update(`emp-portal-otp:${employeeId}:${code.trim()}`).digest('hex');
}

export async function sendEmployeePortalPasswordResetOtp(
  businessId: string,
  businessName: string,
  rawPhone: string
): Promise<{ sent: boolean; devOtp?: string; message: string }> {
  const phone = normalizePhoneOrNull(rawPhone);
  if (!phone) {
    return { sent: false, message: 'Invalid phone number' };
  }

  const employee = await queryOne<{ id: string; name: string }>(
    `SELECT e.id, u.name
     FROM employees e
     INNER JOIN users u ON u.id = e.id
     WHERE u.phone = $1 AND e.business_id = $2 AND e.is_active = true AND u.is_active = true`,
    [phone, businessId]
  );

  if (!employee) {
    return { sent: true, message: GENERIC_SENT_MESSAGE };
  }

  const otpCode = generatePortalOtpCode();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + OTP_TTL_MINUTES);

  await query(
    `DELETE FROM employee_portal_otps
     WHERE employee_id = $1 AND purpose = 'password_reset' AND is_used = false`,
    [employee.id]
  );

  await query(
    `INSERT INTO employee_portal_otps (business_id, employee_id, phone, otp_code, purpose, expires_at)
     VALUES ($1, $2, $3, $4, 'password_reset', $5)`,
    [businessId, employee.id, phone, hashPortalOtp(employee.id, otpCode), expiresAt]
  );

  const text = [
    `Hello ${employee.name},`,
    '',
    `Your ${businessName} employee portal password reset code is: ${otpCode}`,
    `Valid for ${OTP_TTL_MINUTES} minutes.`,
    '',
    'If you did not request this, ignore this message.',
  ].join('\n');

  const isDevelopment = process.env.NODE_ENV === 'development';
  let sent = false;

  try {
    const waStatus = await getWhatsAppStatus(businessId);
    if (waStatus.status === 'connected') {
      await sendWhatsAppMessage(businessId, phone, text, undefined, 'text');
      sent = true;
    } else if (isDevelopment) {
      console.log(`[DEV] Portal password reset OTP for ${phone}: ${otpCode}`);
      sent = true;
    }
  } catch (error) {
    console.error('[employee portal forgot-password]', error);
    if (isDevelopment) {
      console.log(`[DEV] Portal password reset OTP for ${phone}: ${otpCode}`);
      sent = true;
    }
  }

  if (!sent) {
    console.warn('[employee portal forgot-password] code not delivered: business WhatsApp not connected');
  }

  // Same answer whether or not the phone belongs to an employee, and whether or not delivery
  // worked, so the endpoint cannot be used to find out who works where.
  return {
    sent: true,
    devOtp: isDevelopment ? otpCode : undefined,
    message: GENERIC_SENT_MESSAGE,
  };
}

export async function resetEmployeePortalPasswordWithOtp(params: {
  businessId: string;
  rawPhone: string;
  otpCode: string;
  newPassword: string;
}): Promise<void> {
  const phone = normalizePhoneOrNull(params.rawPhone);
  if (!phone) {
    throw new Error('Invalid phone number');
  }

  const employee = await queryOne<{ id: string }>(
    `SELECT e.id
     FROM employees e
     INNER JOIN users u ON u.id = e.id
     WHERE u.phone = $1 AND e.business_id = $2 AND e.is_active = true AND u.is_active = true`,
    [phone, params.businessId]
  );

  if (!employee) {
    throw new Error('Invalid verification code');
  }

  const guesses = checkRateLimit(`emp-portal-otp-guess:${employee.id}`, OTP_GUESS_LIMIT, OTP_GUESS_WINDOW_MS);
  if (!guesses.allowed) {
    await query(
      `UPDATE employee_portal_otps SET is_used = true
        WHERE employee_id = $1 AND purpose = 'password_reset' AND is_used = false`,
      [employee.id]
    );
    throw new Error('Too many attempts. Request a new code later.');
  }

  const otp = await queryOne<{ id: string }>(
    `SELECT id FROM employee_portal_otps
     WHERE business_id = $1 AND employee_id = $2 AND phone = $3 AND otp_code = $4
       AND purpose = 'password_reset'
       AND expires_at > CURRENT_TIMESTAMP AND is_used = false
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.businessId, employee.id, phone, hashPortalOtp(employee.id, params.otpCode)]
  );

  if (!otp) {
    throw new Error('Invalid or expired verification code');
  }

  await query(`UPDATE employee_portal_otps SET is_used = true WHERE id = $1`, [otp.id]);

  await updateEmployeePortalPassword(employee.id, params.businessId, params.newPassword, {
    mustChange: false,
  });

  // A reset means the old password may be known to someone else: end every session.
  await query(`DELETE FROM employee_portal_sessions WHERE employee_id = $1`, [employee.id]);
  await query(
    `UPDATE users SET auth_session_version = COALESCE(auth_session_version, 0) + 1 WHERE id = $1`,
    [employee.id]
  );
}
