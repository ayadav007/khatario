/**
 * Subscription Lifecycle Email Notifications
 *
 * Sends email notifications for trial expiry, grace period, cancellations,
 * and usage limit warnings. Tracks sent notifications in subscription_notifications
 * to prevent duplicates.
 */

import { query, queryOne, queryRows } from '@/lib/db';
import { sendPlatformEmail } from '@/lib/platform-email';
import { getBusinessSubscription, checkLimit } from '@/lib/subscription';

// ─── Types ───────────────────────────────────────────────────────────────────

type NotificationType =
  | 'trial_expiring_7'
  | 'trial_expiring_3'
  | 'trial_expiring_1'
  | 'trial_expired'
  | 'grace_expired'
  | 'cancellation_confirmed'
  | 'usage_limit_80'
  | 'usage_limit_90'
  | 'usage_limit_100';

import { ALL_LIMIT_CHECK_TYPES, type LimitCheckType as LimitType } from '@/lib/subscription/limit-registry';

interface RecipientInfo {
  businessEmail: string | null;
  adminEmail: string | null;
  businessName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Look up business email and primary admin email for a given business.
 * Returns both so we can send to each unique address.
 */
async function getRecipients(businessId: string): Promise<RecipientInfo | null> {
  try {
    const business = await queryOne<{ email: string | null; name: string }>(
      `SELECT email, name FROM businesses WHERE id = $1`,
      [businessId],
    );
    if (!business) return null;

    const admin = await queryOne<{ email: string }>(
      `SELECT email FROM users WHERE business_id = $1 AND is_primary_admin = true AND email IS NOT NULL AND TRIM(email) != '' LIMIT 1`,
      [businessId],
    );

    return {
      businessEmail: business.email?.trim() || null,
      adminEmail: admin?.email?.trim() || null,
      businessName: business.name || 'Your Business',
    };
  } catch (err) {
    console.error(`[notifications] Failed to look up recipients for business ${businessId}:`, err);
    return null;
  }
}

/**
 * Send an email to all unique recipient addresses (business + admin).
 * Returns true if at least one email was sent successfully.
 */
async function sendToRecipients(
  recipients: RecipientInfo,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  const addresses = new Set<string>();
  if (recipients.businessEmail) addresses.add(recipients.businessEmail);
  if (recipients.adminEmail) addresses.add(recipients.adminEmail);

  if (addresses.size === 0) {
    console.warn('[notifications] No recipient email addresses found');
    return false;
  }

  let anySent = false;
  for (const to of addresses) {
    const ok = await sendPlatformEmail({
      to,
      subject,
      html,
      text,
      templateKey: 'subscription_lifecycle',
    });
    if (ok) anySent = true;
  }
  return anySent;
}

/**
 * Check whether a notification of the given type has already been sent
 * to this business today (uses the UNIQUE constraint on
 * business_id + notification_type + sent_at::date).
 */
async function wasAlreadySentToday(
  businessId: string,
  notificationType: NotificationType,
): Promise<boolean> {
  try {
    const row = await queryOne(
      `SELECT id FROM subscription_notifications
       WHERE business_id = $1
         AND notification_type = $2
         AND sent_at::date = CURRENT_DATE
       LIMIT 1`,
      [businessId, notificationType],
    );
    return !!row;
  } catch (err) {
    console.error('[notifications] Error checking duplicate notification:', err);
    return false;
  }
}

/**
 * Record a sent notification so it is not sent again today.
 */
async function logNotification(
  businessId: string,
  notificationType: NotificationType,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await query(
      `INSERT INTO subscription_notifications (business_id, notification_type, metadata, sent_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT DO NOTHING`,
      [businessId, notificationType, metadata ? JSON.stringify(metadata) : null],
    );
  } catch (err) {
    console.error('[notifications] Failed to log notification:', err);
  }
}

// ─── Email layout ────────────────────────────────────────────────────────────

function wrapHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
  .header h1 { margin: 0; font-size: 22px; }
  .content { background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px; }
  .cta { display: inline-block; background: #667eea; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin-top: 16px; font-weight: bold; }
  .footer { text-align: center; margin-top: 30px; color: #999; font-size: 12px; }
  .highlight { background: #f8f4ff; border-left: 4px solid #667eea; padding: 12px 16px; margin: 16px 0; border-radius: 0 4px 4px 0; }
</style>
</head>
<body>
<div class="container">
  <div class="header"><h1>${title}</h1></div>
  <div class="content">${bodyHtml}</div>
  <div class="footer">
    <p>This is an automated email from Khatario.</p>
    <p>&copy; ${new Date().getFullYear()} Khatario. All rights reserved.</p>
  </div>
</div>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Send an email when a business's trial is about to expire.
 * Uses different messaging for 7, 3, and 1 day(s) remaining.
 * Skips if the same notification was already sent today.
 *
 * @param businessId - The business ID
 * @param daysRemaining - Days until trial expires (7, 3, or 1)
 */
export async function sendTrialExpiringEmail(
  businessId: string,
  daysRemaining: number,
): Promise<void> {
  try {
    const notifType: NotificationType =
      daysRemaining >= 7 ? 'trial_expiring_7'
      : daysRemaining >= 3 ? 'trial_expiring_3'
      : 'trial_expiring_1';

    if (await wasAlreadySentToday(businessId, notifType)) return;

    const recipients = await getRecipients(businessId);
    if (!recipients) return;

    const dayWord = daysRemaining === 1 ? 'day' : 'days';
    const subject = `[Khatario] Your trial expires in ${daysRemaining} ${dayWord}`;

    let urgencyNote = '';
    if (daysRemaining <= 1) {
      urgencyNote = `<p style="color:#e53e3e;font-weight:bold;">This is your final reminder &mdash; your trial ends tomorrow.</p>`;
    } else if (daysRemaining <= 3) {
      urgencyNote = `<p style="color:#dd6b20;font-weight:bold;">Your trial is ending very soon. Don't lose access to your data.</p>`;
    }

    const html = wrapHtml('Trial Expiring Soon', `
      <p>Hi,</p>
      <p>Your free trial of <strong>Khatario</strong> for <strong>${recipients.businessName}</strong> will expire in <strong>${daysRemaining} ${dayWord}</strong>.</p>
      ${urgencyNote}
      <div class="highlight">
        <strong>What happens next?</strong><br/>
        After your trial ends you will have a 7-day grace period during which your data remains intact, but some features may be restricted.
        To avoid any interruption, upgrade to a paid plan today.
      </div>
      <p><a class="cta" href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription">Upgrade Now</a></p>
      <p>If you have any questions, reply to this email and we'll be happy to help.</p>
      <p>Best regards,<br/><strong>The Khatario Team</strong></p>
    `);

    const text = [
      `Hi,`,
      `Your free trial of Khatario for ${recipients.businessName} will expire in ${daysRemaining} ${dayWord}.`,
      `After your trial ends you will have a 7-day grace period. To avoid interruption, upgrade today.`,
      `Upgrade: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription`,
      `Best regards, The Khatario Team`,
    ].join('\n\n');

    const sent = await sendToRecipients(recipients, subject, html, text);
    if (sent) {
      await logNotification(businessId, notifType, { daysRemaining });
    }
  } catch (err) {
    console.error(`[notifications] sendTrialExpiringEmail failed for business ${businessId}:`, err);
  }
}

/**
 * Send an email when a trial has just expired (extend-or-free modal in app).
 */
export async function sendTrialExpiredEmail(businessId: string): Promise<void> {
  try {
    if (await wasAlreadySentToday(businessId, 'trial_expired')) return;

    const recipients = await getRecipients(businessId);
    if (!recipients) return;

    const subject = '[Khatario] Your trial has expired';

    const html = wrapHtml('Trial Expired', `
      <p>Hi,</p>
      <p>The free trial for <strong>${recipients.businessName}</strong> on Khatario has ended.</p>
      <div class="highlight">
        <strong>One-time extension available</strong><br/>
        Log in to Khatario to get 7 more days of full access (one time only), or continue on the Free plan.
        Your data remains safe either way.
      </div>
      <p><a class="cta" href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/dashboard">Open Khatario</a></p>
      <p>Need help choosing a plan? Reply to this email and we'll guide you.</p>
      <p>Best regards,<br/><strong>The Khatario Team</strong></p>
    `);

    const text = [
      `Hi,`,
      `The free trial for ${recipients.businessName} on Khatario has ended.`,
      `Log in to get a one-time 7-day extension or continue on the Free plan.`,
      `Open app: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/dashboard`,
      `Best regards, The Khatario Team`,
    ].join('\n\n');

    const sent = await sendToRecipients(recipients, subject, html, text);
    if (sent) {
      await logNotification(businessId, 'trial_expired');
    }
  } catch (err) {
    console.error(`[notifications] sendTrialExpiredEmail failed for business ${businessId}:`, err);
  }
}

/**
 * Send an email when the grace period has ended and the account has been
 * downgraded to the Free plan.
 *
 * @param businessId - The business ID
 */
export async function sendGraceExpiredEmail(businessId: string): Promise<void> {
  try {
    if (await wasAlreadySentToday(businessId, 'grace_expired')) return;

    const recipients = await getRecipients(businessId);
    if (!recipients) return;

    const subject = '[Khatario] Your account has been downgraded to Free';

    const html = wrapHtml('Account Downgraded', `
      <p>Hi,</p>
      <p>The grace period for <strong>${recipients.businessName}</strong> has ended and your account has been downgraded to the <strong>Free plan</strong>.</p>
      <div class="highlight">
        <strong>What does this mean?</strong><br/>
        <ul style="margin:8px 0;padding-left:20px;">
          <li>Your data is still safe and accessible.</li>
          <li>Premium features (advanced reports, integrations, etc.) are now disabled.</li>
          <li>Usage limits have been reduced to Free-plan levels.</li>
        </ul>
      </div>
      <p>You can upgrade at any time to restore full access instantly.</p>
      <p><a class="cta" href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription">Upgrade Now</a></p>
      <p>Best regards,<br/><strong>The Khatario Team</strong></p>
    `);

    const text = [
      `Hi,`,
      `The grace period for ${recipients.businessName} has ended and your account has been downgraded to the Free plan.`,
      `Your data is still safe. Premium features are now disabled and usage limits have been reduced.`,
      `You can upgrade at any time to restore full access.`,
      `Upgrade: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription`,
      `Best regards, The Khatario Team`,
    ].join('\n\n');

    const sent = await sendToRecipients(recipients, subject, html, text);
    if (sent) {
      await logNotification(businessId, 'grace_expired');
    }
  } catch (err) {
    console.error(`[notifications] sendGraceExpiredEmail failed for business ${businessId}:`, err);
  }
}

/**
 * Send a confirmation email when a subscription cancellation has been scheduled.
 *
 * @param businessId - The business ID
 * @param cancelDate - Date the subscription will actually end (end of billing period)
 */
export async function sendCancellationConfirmedEmail(
  businessId: string,
  cancelDate: Date | string,
): Promise<void> {
  try {
    if (await wasAlreadySentToday(businessId, 'cancellation_confirmed')) return;

    const recipients = await getRecipients(businessId);
    if (!recipients) return;

    const formattedDate = new Date(cancelDate).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const subject = '[Khatario] Cancellation confirmed';

    const html = wrapHtml('Cancellation Confirmed', `
      <p>Hi,</p>
      <p>We've received your cancellation request for <strong>${recipients.businessName}</strong>.</p>
      <div class="highlight">
        <strong>Your subscription will remain active until ${formattedDate}.</strong><br/>
        You can continue using all features until then. After that date your account will be moved to the Free plan.
      </div>
      <p>Changed your mind? You can reactivate your subscription anytime before ${formattedDate} from your account settings.</p>
      <p><a class="cta" href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription">Manage Subscription</a></p>
      <p>We're sorry to see you go. If there's anything we can do to improve, please let us know.</p>
      <p>Best regards,<br/><strong>The Khatario Team</strong></p>
    `);

    const text = [
      `Hi,`,
      `We've received your cancellation request for ${recipients.businessName}.`,
      `Your subscription will remain active until ${formattedDate}. After that your account moves to the Free plan.`,
      `Changed your mind? Reactivate anytime before ${formattedDate}.`,
      `Manage: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription`,
      `Best regards, The Khatario Team`,
    ].join('\n\n');

    const sent = await sendToRecipients(recipients, subject, html, text);
    if (sent) {
      await logNotification(businessId, 'cancellation_confirmed', { cancelDate: formattedDate });
    }
  } catch (err) {
    console.error(`[notifications] sendCancellationConfirmedEmail failed for business ${businessId}:`, err);
  }
}

/**
 * Send a warning email when a business is approaching a usage limit.
 * Uses different templates for 80 %, 90 %, and 100 % thresholds.
 *
 * @param businessId - The business ID
 * @param limitType - Which limit is being approached
 * @param currentCount - Current usage count
 * @param maxLimit - Maximum allowed by plan
 * @param percentUsed - Percentage of limit used (80, 90, or 100)
 */
export async function sendUsageLimitWarningEmail(
  businessId: string,
  limitType: string,
  currentCount: number,
  maxLimit: number,
  percentUsed: number,
): Promise<void> {
  try {
    const notifType: NotificationType =
      percentUsed >= 100 ? 'usage_limit_100'
      : percentUsed >= 90 ? 'usage_limit_90'
      : 'usage_limit_80';

    const compositeType = `${notifType}_${limitType}` as NotificationType;
    if (await wasAlreadySentToday(businessId, compositeType)) return;

    const recipients = await getRecipients(businessId);
    if (!recipients) return;

    const friendlyLimit = limitType.replace(/_/g, ' ');
    const subject =
      percentUsed >= 100
        ? `[Khatario] You've reached your ${friendlyLimit} limit`
        : `[Khatario] You've used ${percentUsed}% of your ${friendlyLimit} limit`;

    let statusColor = '#dd6b20';
    let statusLabel = 'Warning';
    if (percentUsed >= 100) {
      statusColor = '#e53e3e';
      statusLabel = 'Limit Reached';
    } else if (percentUsed >= 90) {
      statusColor = '#e53e3e';
      statusLabel = 'Critical';
    }

    const html = wrapHtml('Usage Limit Warning', `
      <p>Hi,</p>
      <p>This is a usage alert for <strong>${recipients.businessName}</strong>.</p>
      <div class="highlight">
        <strong style="color:${statusColor};">${statusLabel}: ${friendlyLimit}</strong><br/>
        <p style="margin:8px 0;">
          Current usage: <strong>${currentCount}</strong> / <strong>${maxLimit}</strong> (${percentUsed}%)
        </p>
        ${percentUsed >= 100
          ? `<p style="color:#e53e3e;">You have reached your limit. New ${friendlyLimit} cannot be created until you upgrade or the next billing cycle.</p>`
          : `<p>You are approaching your plan limit. Consider upgrading to avoid interruption.</p>`
        }
      </div>
      <p><a class="cta" href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription">Upgrade Plan</a></p>
      <p>Best regards,<br/><strong>The Khatario Team</strong></p>
    `);

    const text = [
      `Hi,`,
      `Usage alert for ${recipients.businessName}: ${friendlyLimit}`,
      `Current usage: ${currentCount} / ${maxLimit} (${percentUsed}%)`,
      percentUsed >= 100
        ? `You have reached your limit. Upgrade to continue.`
        : `You are approaching your limit. Consider upgrading.`,
      `Upgrade: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription`,
      `Best regards, The Khatario Team`,
    ].join('\n\n');

    const sent = await sendToRecipients(recipients, subject, html, text);
    if (sent) {
      await logNotification(businessId, compositeType, {
        limitType,
        currentCount,
        maxLimit,
        percentUsed,
      });
    }
  } catch (err) {
    console.error(`[notifications] sendUsageLimitWarningEmail failed for business ${businessId}:`, err);
  }
}

/**
 * Batch function intended to be called by a cron job.
 * Finds all businesses that need a notification and sends pending emails.
 *
 * Checks performed:
 *  1. Trials ending in 7 / 3 / 1 day(s)
 *  2. Grace period ending in 3 days
 *  3. Usage at 80 %+ for any tracked limit
 *
 * Already-sent notifications (same type + business + today) are skipped.
 *
 * @returns The total number of notifications sent
 */
export async function sendPendingNotifications(): Promise<number> {
  let sentCount = 0;

  try {
    // ── 1. Trial expiring in 7 / 3 / 1 day(s) ─────────────────────────────
    const trialExpiring = await queryRows<{
      business_id: string;
      days_remaining: number;
    }>(
      `SELECT bs.business_id,
              (bs.trial_end_date::date - CURRENT_DATE) AS days_remaining
       FROM business_subscriptions bs
       WHERE bs.status = 'trial'
         AND bs.trial_end_date IS NOT NULL
         AND (bs.trial_end_date::date - CURRENT_DATE) IN (7, 3, 1)`,
    );

    for (const row of trialExpiring) {
      const notifType: NotificationType =
        row.days_remaining >= 7 ? 'trial_expiring_7'
        : row.days_remaining >= 3 ? 'trial_expiring_3'
        : 'trial_expiring_1';

      if (await wasAlreadySentToday(row.business_id, notifType)) continue;

      await sendTrialExpiringEmail(row.business_id, row.days_remaining);
      sentCount++;
    }

    // ── 2. Grace period ending in 3 days ────────────────────────────────────
    // Grace = trial_end_date + 7 days.  3 days before that = trial_end_date + 4 days.
    const graceEnding = await queryRows<{ business_id: string }>(
      `SELECT bs.business_id
       FROM business_subscriptions bs
       WHERE bs.status = 'expired'
         AND bs.trial_end_date IS NOT NULL
         AND (bs.trial_end_date::date + INTERVAL '4 days')::date = CURRENT_DATE`,
    );

    for (const row of graceEnding) {
      const notifType = 'trial_expiring_3' as NotificationType;
      if (await wasAlreadySentToday(row.business_id, notifType)) continue;

      const recipients = await getRecipients(row.business_id);
      if (!recipients) continue;

      const subject = '[Khatario] Your grace period ends in 3 days';
      const html = wrapHtml('Grace Period Ending', `
        <p>Hi,</p>
        <p>The grace period for <strong>${recipients.businessName}</strong> ends in <strong>3 days</strong>.</p>
        <div class="highlight">
          After the grace period your account will be downgraded to the Free plan and premium features will be disabled.
          Upgrade now to keep full access.
        </div>
        <p><a class="cta" href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription">Upgrade Now</a></p>
        <p>Best regards,<br/><strong>The Khatario Team</strong></p>
      `);
      const text = [
        `Hi,`,
        `The grace period for ${recipients.businessName} ends in 3 days.`,
        `Upgrade now to keep full access.`,
        `Upgrade: ${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/settings/subscription`,
        `Best regards, The Khatario Team`,
      ].join('\n\n');

      const sent = await sendToRecipients(recipients, subject, html, text);
      if (sent) {
        await logNotification(row.business_id, notifType, { context: 'grace_period_ending' });
        sentCount++;
      }
    }

    // ── 3. Usage at 80 %+ ──────────────────────────────────────────────────
    const activeBusinesses = await queryRows<{ business_id: string }>(
      `SELECT DISTINCT business_id
       FROM business_subscriptions
       WHERE status IN ('active', 'trial')`,
    );

    const limitTypes: LimitType[] = ALL_LIMIT_CHECK_TYPES;

    for (const biz of activeBusinesses) {
      for (const lt of limitTypes) {
        try {
          const check = await checkLimit(biz.business_id, lt);
          if (check.limit <= 0 || check.limit === -1) continue;

          const pct = Math.round((check.current / check.limit) * 100);
          if (pct < 80) continue;

          const bucket = pct >= 100 ? 100 : pct >= 90 ? 90 : 80;
          const compositeType = `usage_limit_${bucket}_${lt}` as NotificationType;

          if (await wasAlreadySentToday(biz.business_id, compositeType)) continue;

          await sendUsageLimitWarningEmail(
            biz.business_id,
            lt,
            check.current,
            check.limit,
            bucket,
          );
          sentCount++;
        } catch (err) {
          console.error(`[notifications] Usage check failed for ${biz.business_id}/${lt}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[notifications] sendPendingNotifications failed:', err);
  }

  console.log(`[notifications] Sent ${sentCount} notification(s)`);
  return sentCount;
}
