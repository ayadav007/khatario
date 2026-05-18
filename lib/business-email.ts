import nodemailer from 'nodemailer';
import { query, queryOne } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/secret-encryption';

export interface BusinessEmailConfigRow {
  business_id: string;
  enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string | null;
  encrypted_smtp_password: string | null;
  from_email: string;
  from_name: string | null;
  reply_to_email: string | null;
}

export interface BusinessEmailConfigPublic {
  enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string | null;
  has_password: boolean;
  from_email: string;
  from_name: string | null;
  reply_to_email: string | null;
}

export interface SaveBusinessEmailConfigInput {
  enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  /** Omit or empty to keep existing password */
  smtp_password?: string;
  from_email: string;
  from_name?: string | null;
  reply_to_email?: string | null;
}

export interface BusinessEmailSendOptions {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

const SETTINGS_PATH = '/settings/email';

export function businessEmailNotConfiguredMessage(): string {
  return `Email is not configured for your business. Add SMTP settings under Settings → Email (${SETTINGS_PATH}).`;
}

export async function getBusinessEmailConfigRow(
  businessId: string
): Promise<BusinessEmailConfigRow | null> {
  return queryOne<BusinessEmailConfigRow>(
    `SELECT business_id, enabled, smtp_host, smtp_port, smtp_secure,
            smtp_user, encrypted_smtp_password, from_email, from_name, reply_to_email
     FROM business_email_config
     WHERE business_id = $1`,
    [businessId]
  );
}

export function toPublicConfig(row: BusinessEmailConfigRow | null): BusinessEmailConfigPublic | null {
  if (!row) return null;
  return {
    enabled: row.enabled,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_secure: row.smtp_secure,
    smtp_user: row.smtp_user,
    has_password: Boolean(row.encrypted_smtp_password),
    from_email: row.from_email,
    from_name: row.from_name,
    reply_to_email: row.reply_to_email,
  };
}

export async function saveBusinessEmailConfig(
  businessId: string,
  input: SaveBusinessEmailConfigInput
): Promise<void> {
  const existing = await getBusinessEmailConfigRow(businessId);

  let encryptedPassword = existing?.encrypted_smtp_password ?? null;
  const newPassword = input.smtp_password?.trim();
  if (newPassword) {
    encryptedPassword = encryptSecret(newPassword);
  } else if (!existing && input.enabled) {
    throw new Error('SMTP password is required when enabling email');
  }

  if (input.enabled && (!input.smtp_user?.trim() || !encryptedPassword)) {
    throw new Error('SMTP username and password are required when email is enabled');
  }

  await query(
    `INSERT INTO business_email_config (
       business_id, enabled, smtp_host, smtp_port, smtp_secure,
       smtp_user, encrypted_smtp_password, from_email, from_name, reply_to_email
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (business_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       smtp_host = EXCLUDED.smtp_host,
       smtp_port = EXCLUDED.smtp_port,
       smtp_secure = EXCLUDED.smtp_secure,
       smtp_user = EXCLUDED.smtp_user,
       encrypted_smtp_password = COALESCE(EXCLUDED.encrypted_smtp_password, business_email_config.encrypted_smtp_password),
       from_email = EXCLUDED.from_email,
       from_name = EXCLUDED.from_name,
       reply_to_email = EXCLUDED.reply_to_email,
       updated_at = CURRENT_TIMESTAMP`,
    [
      businessId,
      input.enabled,
      input.smtp_host.trim(),
      input.smtp_port,
      input.smtp_secure,
      input.smtp_user.trim() || null,
      encryptedPassword,
      input.from_email.trim(),
      input.from_name?.trim() || null,
      input.reply_to_email?.trim() || null,
    ]
  );
}

function resolveSmtpPassword(row: BusinessEmailConfigRow): string | null {
  if (!row.encrypted_smtp_password) return null;
  try {
    return decryptSecret(row.encrypted_smtp_password);
  } catch (e) {
    console.error('[business-email] Failed to decrypt SMTP password:', e);
    return null;
  }
}

export async function isBusinessEmailReady(businessId: string): Promise<boolean> {
  const row = await getBusinessEmailConfigRow(businessId);
  if (!row?.enabled) return false;
  if (!row.smtp_user?.trim() || !row.from_email?.trim()) return false;
  return Boolean(resolveSmtpPassword(row));
}

export async function sendBusinessEmail(
  businessId: string,
  options: BusinessEmailSendOptions
): Promise<{ success: boolean; error?: string }> {
  const { checkLimit } = await import('@/lib/subscription');
  const emailLimit = await checkLimit(businessId, 'email');
  if (!emailLimit.allowed) {
    return {
      success: false,
      error: emailLimit.message ?? 'Daily email limit reached for your plan.',
    };
  }

  const row = await getBusinessEmailConfigRow(businessId);
  if (!row?.enabled) {
    return { success: false, error: businessEmailNotConfiguredMessage() };
  }

  const password = resolveSmtpPassword(row);
  if (!row.smtp_user?.trim() || !password) {
    return { success: false, error: businessEmailNotConfiguredMessage() };
  }

  const port = Number(row.smtp_port) || 587;
  const secure = row.smtp_secure || port === 465;

  try {
    const transporter = nodemailer.createTransport({
      host: row.smtp_host,
      port,
      secure,
      auth: {
        user: row.smtp_user,
        pass: password,
      },
    });

    const fromName = row.from_name?.trim() || row.from_email;
    await transporter.sendMail({
      from: `"${fromName}" <${row.from_email}>`,
      replyTo: row.reply_to_email?.trim() || undefined,
      to: options.to,
      ...(options.cc ? { cc: options.cc } : {}),
      ...(options.bcc ? { bcc: options.bcc } : {}),
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    });

    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[business-email] Send failed:', error);
    return { success: false, error: msg || 'Failed to send email' };
  }
}

export async function verifyBusinessEmailConfig(
  businessId: string,
  testRecipient?: string
): Promise<{ success: boolean; message: string }> {
  const row = await getBusinessEmailConfigRow(businessId);
  if (!row) {
    return { success: false, message: 'Save your email settings first.' };
  }

  const password = resolveSmtpPassword(row);
  if (!row.smtp_user?.trim() || !password) {
    return { success: false, message: 'SMTP username and password are required.' };
  }

  const port = Number(row.smtp_port) || 587;
  const secure = row.smtp_secure || port === 465;

  try {
    const transporter = nodemailer.createTransport({
      host: row.smtp_host,
      port,
      secure,
      auth: { user: row.smtp_user, pass: password },
    });

    await transporter.verify();

    if (testRecipient?.trim() && testRecipient.includes('@')) {
      const fromName = row.from_name?.trim() || row.from_email;
      await transporter.sendMail({
        from: `"${fromName}" <${row.from_email}>`,
        to: testRecipient.trim(),
        subject: 'Khatario — test email',
        text: 'Your business email (SMTP) settings are working.',
        html: '<p>Your business email (SMTP) settings are working.</p>',
      });
      return {
        success: true,
        message: `Connection verified. Test email sent to ${testRecipient.trim()}.`,
      };
    }

    return { success: true, message: 'SMTP connection verified successfully.' };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: msg || 'SMTP verification failed' };
  }
}
