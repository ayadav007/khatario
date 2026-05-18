import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { sendDailyInvoiceSummaryEmail } from '@/lib/business-reminder-email';
import { getBusinessSubscription, isSubscriptionOperationalStatus } from '@/lib/subscription';
import { assertCronAuthorized } from '@/lib/cron-auth';

/**
 * POST /api/cron/send-daily-invoice-summary
 * Background job endpoint to send daily invoice summary emails to all business owners
 * Can be called via external cron service (e.g., cron-job.org) or internal scheduler
 * Recommended: Schedule to run daily at 9:00 AM IST
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  try {
    // Get all active businesses with email addresses
    const businesses = await db.queryRows<{ id: string; name: string; email: string }>(`
      SELECT id, name, email 
      FROM businesses 
      WHERE email IS NOT NULL 
        AND TRIM(email) != ''
        AND platform_suspended_at IS NULL
    `);

    const results: Array<{
      business_id: string;
      business_name: string;
      success: boolean;
      error?: string;
    }> = [];

    let successCount = 0;
    let failCount = 0;

    for (const business of businesses) {
      try {
        // CRITICAL: Check if business has active subscription
        // Skip processing if subscription is inactive or expired
        const subscription = await getBusinessSubscription(business.id);
        if (!subscription || !isSubscriptionOperationalStatus(subscription.status)) {
          console.log(`Skipping business ${business.id}: subscription inactive or expired`);
          failCount++;
          results.push({
            business_id: business.id,
            business_name: business.name,
            success: false,
            error: 'Subscription inactive or expired'
          });
          continue;
        }

        // Check if subscription has expired (if end_date is set)
        if (subscription.end_date) {
          const endDate = new Date(subscription.end_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          if (endDate < today) {
            console.log(`Skipping business ${business.id}: subscription expired on ${subscription.end_date}`);
            failCount++;
            results.push({
              business_id: business.id,
              business_name: business.name,
              success: false,
              error: `Subscription expired on ${subscription.end_date}`
            });
            continue;
          }
        }

        const sent = await sendDailyInvoiceSummaryEmail(business.id);
        
        if (sent) {
          successCount++;
          results.push({
            business_id: business.id,
            business_name: business.name,
            success: true
          });
        } else {
          failCount++;
          results.push({
            business_id: business.id,
            business_name: business.name,
            success: false,
            error: 'Email sending failed'
          });
        }
      } catch (error: any) {
        failCount++;
        console.error(`Error sending summary for business ${business.id}:`, error);
        results.push({
          business_id: business.id,
          business_name: business.name,
          success: false,
          error: error.message || 'Unknown error'
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed: businesses.length,
      success_count: successCount,
      fail_count: failCount,
      results
    });
  } catch (error: any) {
    console.error('Error in daily invoice summary cron job:', error);
    return NextResponse.json(
      { error: 'Failed to process daily summaries', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/send-daily-invoice-summary
 * Allow GET requests for easier cron setup
 */
export async function GET(request: NextRequest) {
  return await POST(request);
}

