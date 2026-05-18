import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { checkAndSendPaymentDueReminders, checkAndSendOverdueReminders } from '@/lib/payment-reminder-checker';
import { getBusinessSubscription, isSubscriptionOperationalStatus } from '@/lib/subscription';
import {
  isInReminderSendWindow,
  reminderTimeToHhMm,
} from '@/lib/reminder-schedule';

/**
 * GET/POST /api/cron/send-payment-reminders
 * Background job: processes businesses with reminder settings enabled.
 *
 * Per-business send time: `business_settings.reminder_send_time` + `reminder_send_timezone` (IANA).
 * The handler only runs payment/overdue processing when "now" is inside that business's
 * 15-minute local window, unless REMINDER_IGNORE_SCHEDULE=1 or `?force=1` (testing).
 *
 * Platform scheduling:
 * - Vercel: `vercel.json` should invoke this at least every 15 minutes (see schedule there).
 *   Set CRON_SECRET; Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations.
 * - Other hosts: call this URL on the same cadence, or more often; same Bearer if CRON_SECRET is set.
 * - Local dev: leave CRON_SECRET unset, or set CRON_SECRET and use the header. Use `?force=1` to ignore the window.
 *
 * BullMQ is not required — this route is the job; something must trigger it on a schedule.
 */
function assertCronAuthorized(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return await processReminders(request);
}

export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return await processReminders(request);
}

async function processReminders(request?: NextRequest) {
  try {
    const ignoreSendWindow =
      process.env.REMINDER_IGNORE_SCHEDULE === '1' ||
      request?.nextUrl.searchParams.get('force') === '1';

    // One row per business: schedule comes from business_settings (LEFT JOIN for legacy rows)
    const businesses = await db.queryRows<{
      business_id: string;
      reminder_send_time: unknown;
      reminder_send_timezone: string | null;
    }>(
      `SELECT DISTINCT ON (w.business_id)
         w.business_id,
         COALESCE(bs.reminder_send_time, TIME '09:00:00') AS reminder_send_time,
         COALESCE(NULLIF(TRIM(bs.reminder_send_timezone), ''), 'Asia/Kolkata') AS reminder_send_timezone
       FROM whatsapp_reminder_settings w
       LEFT JOIN business_settings bs ON bs.business_id = w.business_id
       WHERE w.enabled = true
       ORDER BY w.business_id, w.reminder_type`
    );

    const results: Array<{
      business_id: string;
      schedule_skipped?: boolean;
      payment_due: { sent: number; skipped: number; errors: number };
      overdue: { sent: number; skipped: number; errors: number };
    }> = [];

    let totalPaymentDueSent = 0;
    let totalOverdueSent = 0;
    let totalErrors = 0;

    for (const business of businesses) {
      try {
        const timeStr = reminderTimeToHhMm(business.reminder_send_time);
        const tz = (business.reminder_send_timezone || 'Asia/Kolkata').trim() || 'Asia/Kolkata';
        if (!ignoreSendWindow && !isInReminderSendWindow(tz, timeStr)) {
          console.log(
            `[payment-reminders] Skipping business ${business.business_id}: outside send window (local ${timeStr} ${tz})`
          );
          results.push({
            business_id: business.business_id,
            schedule_skipped: true,
            payment_due: { sent: 0, skipped: 0, errors: 0 },
            overdue: { sent: 0, skipped: 0, errors: 0 },
          });
          continue;
        }

        // CRITICAL: Check if business has active subscription
        // Skip processing if subscription is inactive or expired
        const subscription = await getBusinessSubscription(business.business_id);
        if (!subscription || !isSubscriptionOperationalStatus(subscription.status)) {
          console.log(`Skipping business ${business.business_id}: subscription inactive or expired`);
          results.push({
            business_id: business.business_id,
            payment_due: { sent: 0, skipped: 1, errors: 0 },
            overdue: { sent: 0, skipped: 1, errors: 0 }
          });
          continue;
        }

        // Check if subscription has expired (if end_date is set)
        if (subscription.end_date) {
          const endDate = new Date(subscription.end_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          if (endDate < today) {
            console.log(`Skipping business ${business.business_id}: subscription expired on ${subscription.end_date}`);
            results.push({
              business_id: business.business_id,
              payment_due: { sent: 0, skipped: 1, errors: 0 },
              overdue: { sent: 0, skipped: 1, errors: 0 }
            });
            continue;
          }
        }

        // Process payment due reminders
        const paymentDueResult = await checkAndSendPaymentDueReminders(business.business_id);
        
        // Process overdue reminders
        const overdueResult = await checkAndSendOverdueReminders(business.business_id);

        results.push({
          business_id: business.business_id,
          payment_due: paymentDueResult,
          overdue: overdueResult
        });

        totalPaymentDueSent += paymentDueResult.sent;
        totalOverdueSent += overdueResult.sent;
        totalErrors += paymentDueResult.errors + overdueResult.errors;
      } catch (error: any) {
        console.error(`Error processing reminders for business ${business.business_id}:`, error);
        totalErrors++;
        results.push({
          business_id: business.business_id,
          payment_due: { sent: 0, skipped: 0, errors: 1 },
          overdue: { sent: 0, skipped: 0, errors: 0 }
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed_businesses: businesses.length,
      summary: {
        payment_due_sent: totalPaymentDueSent,
        overdue_sent: totalOverdueSent,
        total_errors: totalErrors
      },
      results
    });
  } catch (error: any) {
    console.error('Error in payment reminders cron job:', error);
    return NextResponse.json(
      { error: 'Failed to process reminders', details: error.message },
      { status: 500 }
    );
  }
}

