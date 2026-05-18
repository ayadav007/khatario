/**
 * Platform-level email (Khatario → tenant or platform admin).
 * Uses global SMTP from .env via lib/email.ts and logs every attempt.
 */

import { query, queryOne, queryRows } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export type PlatformEmailTemplateKey =
  | 'welcome'
  | 'subscription_upgraded'
  | 'payment_success'
  | 'payment_failed'
  | 'admin_new_signup'
  | 'admin_subscription_change'
  | 'admin_payment_failure'
  | 'subscription_lifecycle';

export interface PlatformNotificationSettings {
  notify_new_signup: boolean;
  notify_subscription_changes: boolean;
  notify_payment_failures: boolean;
  platform_notify_email: string | null;
}

const DEFAULT_SETTINGS: PlatformNotificationSettings = {
  notify_new_signup: true,
  notify_subscription_changes: true,
  notify_payment_failures: true,
  platform_notify_email: null,
};

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com';

export function platformEmailLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;margin:0;padding:0;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <h1 style="font-size:20px;margin:0 0 16px;">${title}</h1>
    ${bodyHtml}
    <p style="margin-top:24px;font-size:12px;color:#6b7280;">
      This is an automated message from Khatario.
    </p>
  </div>
</body>
</html>`;
}

async function logPlatformEmail(params: {
  recipientEmail: string;
  subject: string;
  templateKey?: PlatformEmailTemplateKey;
  businessId?: string;
  status: 'sent' | 'failed' | 'skipped';
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO platform_email_logs
         (recipient_email, subject, template_key, business_id, status, error_message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.recipientEmail,
        params.subject,
        params.templateKey ?? null,
        params.businessId ?? null,
        params.status,
        params.errorMessage ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
      ],
    );
  } catch (err) {
    console.error('[platform-email] Failed to log email:', err);
  }
}

export async function getPlatformNotificationSettings(): Promise<PlatformNotificationSettings> {
  try {
    const row = await queryOne<{
      notify_new_signup: boolean;
      notify_subscription_changes: boolean;
      notify_payment_failures: boolean;
      platform_notify_email: string | null;
    }>(
      `SELECT notify_new_signup, notify_subscription_changes, notify_payment_failures, platform_notify_email
       FROM platform_settings WHERE id = 'default'`,
    );
    if (!row) return { ...DEFAULT_SETTINGS };
    return {
      notify_new_signup: row.notify_new_signup ?? true,
      notify_subscription_changes: row.notify_subscription_changes ?? true,
      notify_payment_failures: row.notify_payment_failures ?? true,
      platform_notify_email: row.platform_notify_email,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function updatePlatformNotificationSettings(
  patch: Partial<PlatformNotificationSettings>,
): Promise<PlatformNotificationSettings> {
  const current = await getPlatformNotificationSettings();
  const next = { ...current, ...patch };
  await query(
    `INSERT INTO platform_settings (
       id, notify_new_signup, notify_subscription_changes, notify_payment_failures, platform_notify_email, updated_at
     ) VALUES ('default', $1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       notify_new_signup = EXCLUDED.notify_new_signup,
       notify_subscription_changes = EXCLUDED.notify_subscription_changes,
       notify_payment_failures = EXCLUDED.notify_payment_failures,
       platform_notify_email = EXCLUDED.platform_notify_email,
       updated_at = NOW()`,
    [
      next.notify_new_signup,
      next.notify_subscription_changes,
      next.notify_payment_failures,
      next.platform_notify_email,
    ],
  );
  return next;
}

/** Resolve platform operator inboxes for admin alerts. Exported for billing module. */
export async function getPlatformAdminRecipientEmails(): Promise<string[]> {
  const settings = await getPlatformNotificationSettings();
  if (settings.platform_notify_email?.trim()) {
    return [settings.platform_notify_email.trim()];
  }
  const admins = await queryRows<{ email: string }>(
    `SELECT email FROM platform_admins WHERE is_active = true AND email IS NOT NULL AND TRIM(email) != ''`,
  );
  return [...new Set(admins.map((a) => a.email.trim()))];
}

export async function sendPlatformEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  templateKey?: PlatformEmailTemplateKey;
  businessId?: string;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const to = params.to?.trim();
  if (!to) {
    await logPlatformEmail({
      recipientEmail: '(empty)',
      subject: params.subject,
      templateKey: params.templateKey,
      businessId: params.businessId,
      status: 'skipped',
      errorMessage: 'No recipient',
      metadata: params.metadata,
    });
    return false;
  }

  if (params.businessId) {
    const { checkLimit } = await import('@/lib/subscription');
    const emailLimit = await checkLimit(params.businessId, 'email');
    if (!emailLimit.allowed) {
      await logPlatformEmail({
        recipientEmail: to,
        subject: params.subject,
        templateKey: params.templateKey,
        businessId: params.businessId,
        status: 'skipped',
        errorMessage: emailLimit.message ?? 'Daily email limit reached',
        metadata: params.metadata,
      });
      return false;
    }
  }

  let status: 'sent' | 'failed' = 'failed';
  let errorMessage: string | null = null;

  try {
    const ok = await sendEmail({
      to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
    if (ok) {
      status = 'sent';
    } else {
      errorMessage = 'SMTP not configured or send returned false';
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  await logPlatformEmail({
    recipientEmail: to,
    subject: params.subject,
    templateKey: params.templateKey,
    businessId: params.businessId,
    status,
    errorMessage,
    metadata: params.metadata,
  });

  return status === 'sent';
}

export async function sendWelcomeEmail(params: {
  businessId: string;
  businessName: string;
  recipientEmail: string;
  userName: string;
  trialDays?: number;
}): Promise<boolean> {
  const { businessId, businessName, recipientEmail, userName, trialDays } = params;
  const trialLine =
    trialDays != null && trialDays > 0
      ? `<p>You have a <strong>${trialDays}-day trial</strong> with full access.</p>`
      : `<p>Your workspace is active and ready to use.</p>`;
  const subject = `Welcome to Khatario, ${businessName}!`;
  const html = platformEmailLayout('Welcome to Khatario', `
    <p>Hi ${userName},</p>
    <p>Your account for <strong>${businessName}</strong> is ready.</p>
    ${trialLine}
    <p>Sign in anytime to start billing, inventory, and GST workflows.</p>
    <p><a href="${APP_URL()}/login" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">Sign in to Khatario</a></p>
    <p>Need help? Reply to this email or visit our support page from the app.</p>
  `);
  const text = [
    `Hi ${userName},`,
    `Your account for ${businessName} is ready.`,
    trialDays != null && trialDays > 0 ? `Trial: ${trialDays} days.` : '',
    `Sign in: ${APP_URL()}/login`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return sendPlatformEmail({
    to: recipientEmail,
    subject,
    html,
    text,
    templateKey: 'welcome',
    businessId,
  });
}

export async function notifyAdminsNewSignup(params: {
  businessId: string;
  businessName: string;
  businessEmail: string | null;
  userName: string;
  userPhone: string;
  planLabel: string;
}): Promise<number> {
  const settings = await getPlatformNotificationSettings();
  if (!settings.notify_new_signup) return 0;

  const recipients = await getPlatformAdminRecipientEmails();
  if (recipients.length === 0) return 0;

  const subject = `[Khatario Admin] New signup: ${params.businessName}`;
  const html = platformEmailLayout('New business signup', `
    <p>A new business registered on Khatario.</p>
    <ul>
      <li><strong>Business:</strong> ${params.businessName}</li>
      <li><strong>Contact:</strong> ${params.userName} (${params.userPhone})</li>
      <li><strong>Email:</strong> ${params.businessEmail || '—'}</li>
      <li><strong>Plan:</strong> ${params.planLabel}</li>
    </ul>
    <p><a href="${APP_URL()}/admin/businesses">View in admin panel</a></p>
  `);
  const text = `New signup: ${params.businessName} — ${params.userName} — plan ${params.planLabel}`;

  let sent = 0;
  for (const to of recipients) {
    const ok = await sendPlatformEmail({
      to,
      subject,
      html,
      text,
      templateKey: 'admin_new_signup',
      businessId: params.businessId,
    });
    if (ok) sent++;
  }
  return sent;
}

export async function sendSubscriptionUpgradedEmail(params: {
  businessId: string;
  businessName: string;
  recipientEmail: string;
  planDisplayName: string;
  billingCycle: string;
}): Promise<boolean> {
  const subject = `[Khatario] Your plan is now ${params.planDisplayName}`;
  const html = platformEmailLayout('Subscription updated', `
    <p>Hi,</p>
    <p><strong>${params.businessName}</strong> is now on the <strong>${params.planDisplayName}</strong> plan (${params.billingCycle}).</p>
    <p><a href="${APP_URL()}/settings/subscription" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;">View subscription</a></p>
  `);
  return sendPlatformEmail({
    to: params.recipientEmail,
    subject,
    html,
    templateKey: 'subscription_upgraded',
    businessId: params.businessId,
  });
}

export async function notifyAdminsSubscriptionChange(params: {
  businessId: string;
  businessName: string;
  planDisplayName: string;
  event: string;
}): Promise<number> {
  const settings = await getPlatformNotificationSettings();
  if (!settings.notify_subscription_changes) return 0;

  const recipients = await getPlatformAdminRecipientEmails();
  if (recipients.length === 0) return 0;

  const subject = `[Khatario Admin] Subscription ${params.event}: ${params.businessName}`;
  const html = platformEmailLayout('Subscription change', `
    <p><strong>${params.businessName}</strong> — ${params.event}</p>
    <p>Plan: <strong>${params.planDisplayName}</strong></p>
    <p><a href="${APP_URL()}/admin/businesses">Open admin</a></p>
  `);

  let sent = 0;
  for (const to of recipients) {
    const ok = await sendPlatformEmail({
      to,
      subject,
      html,
      templateKey: 'admin_subscription_change',
      businessId: params.businessId,
    });
    if (ok) sent++;
  }
  return sent;
}

/** Best-effort recipient for a business (business email, else primary admin user email). */
export async function getBusinessPlatformRecipient(
  businessId: string,
): Promise<{ email: string | null; businessName: string } | null> {
  const row = await queryOne<{ email: string | null; name: string }>(
    `SELECT email, name FROM businesses WHERE id = $1`,
    [businessId],
  );
  if (!row) return null;

  if (row.email?.trim()) {
    return { email: row.email.trim(), businessName: row.name || 'Your Business' };
  }

  const admin = await queryOne<{ email: string }>(
    `SELECT email FROM users WHERE business_id = $1 AND is_primary_admin = true AND email IS NOT NULL AND TRIM(email) != '' LIMIT 1`,
    [businessId],
  );
  return {
    email: admin?.email?.trim() ?? null,
    businessName: row.name || 'Your Business',
  };
}
