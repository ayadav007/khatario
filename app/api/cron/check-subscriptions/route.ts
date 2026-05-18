import { NextRequest, NextResponse } from 'next/server';
import { processExpiredSubscriptions } from '@/lib/subscription/lifecycle';
import { sendPendingNotifications } from '@/lib/subscription/notifications';
import { queryRows, query } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron-auth';

async function runSubscriptionCron() {
  const expiredCounts = await processExpiredSubscriptions();
  const notificationsSent = await sendPendingNotifications();

  const activeBusinesses = await queryRows<{ business_id: string }>(
    `SELECT DISTINCT business_id
     FROM business_subscriptions
     WHERE status IN ('active', 'trial')`,
  );

  let snapshotsInserted = 0;

  for (const { business_id } of activeBusinesses) {
    const sub = await queryRows<{ plan_id: string }>(
      `SELECT plan_id FROM business_subscriptions WHERE business_id = $1 LIMIT 1`,
      [business_id],
    );
    const planId = sub[0]?.plan_id ?? 'free';

    const counts = await queryRows<{ metric: string; count: string }>(
      `SELECT 'invoices' AS metric, COUNT(*)::text AS count FROM invoices WHERE business_id = $1
       UNION ALL
       SELECT 'customers', COUNT(*)::text FROM customers WHERE business_id = $1
       UNION ALL
       SELECT 'items', COUNT(*)::text FROM items WHERE business_id = $1
       UNION ALL
       SELECT 'users', COUNT(*)::text FROM users WHERE business_id = $1
       UNION ALL
       SELECT 'employees', COUNT(*)::text FROM employees WHERE business_id = $1
       UNION ALL
       SELECT 'suppliers', COUNT(*)::text FROM suppliers WHERE business_id = $1`,
      [business_id],
    );

    const snapshot: Record<string, number> = {};
    for (const row of counts) {
      snapshot[row.metric] = parseInt(row.count, 10);
    }

    await query(
      `INSERT INTO subscription_usage_snapshots
         (business_id, plan_id, snapshot_date, invoices_count, customers_count, items_count, users_count, employees_count, suppliers_count)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (business_id, snapshot_date) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         invoices_count  = EXCLUDED.invoices_count,
         customers_count = EXCLUDED.customers_count,
         items_count     = EXCLUDED.items_count,
         users_count     = EXCLUDED.users_count,
         employees_count = EXCLUDED.employees_count,
         suppliers_count = EXCLUDED.suppliers_count`,
      [
        business_id,
        planId,
        snapshot.invoices ?? 0,
        snapshot.customers ?? 0,
        snapshot.items ?? 0,
        snapshot.users ?? 0,
        snapshot.employees ?? 0,
        snapshot.suppliers ?? 0,
      ],
    );

    snapshotsInserted++;
  }

  return {
    success: true,
    summary: {
      expired: expiredCounts,
      notificationsSent,
      usageSnapshots: snapshotsInserted,
    },
  };
}

/** Daily: expire trials, send lifecycle emails, record usage snapshots. */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  try {
    const body = await runSubscriptionCron();
    return NextResponse.json(body);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error in subscription cron job:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: message },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
