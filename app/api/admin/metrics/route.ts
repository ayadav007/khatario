import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/metrics
 * Fetch platform-wide metrics for admin dashboard
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_view_metrics');
    if (!auth.ok) return auth.response;

    // Total businesses
    const totalBusinessesResult = await db.queryOne(`
      SELECT COUNT(*) as count FROM businesses
    `);
    const totalBusinesses = parseInt(totalBusinessesResult?.count || '0');

    // Active businesses (have created at least 1 invoice)
    const activeBusinessesResult = await db.queryOne(`
      SELECT COUNT(DISTINCT business_id) as count 
      FROM invoices
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);
    const activeBusinesses = parseInt(activeBusinessesResult?.count || '0');

    // Total subscriptions by plan
    const subscriptionsByPlan = await db.queryRows(`
      SELECT 
        sp.display_name as plan_name,
        sp.id as plan_id,
        COUNT(bs.id) as count
      FROM subscription_plans sp
      LEFT JOIN business_subscriptions bs ON sp.id = bs.plan_id AND bs.status IN ('active', 'trial')
      GROUP BY sp.id, sp.display_name, sp.sort_order
      ORDER BY sp.sort_order
    `);

    // Monthly Recurring Revenue (MRR)
    const mrrResult = await db.queryOne(`
      SELECT 
        SUM(sp.price_monthly) as mrr
      FROM business_subscriptions bs
      JOIN subscription_plans sp ON bs.plan_id = sp.id
      WHERE bs.status IN ('active', 'trial')
        AND bs.plan_id NOT IN ('free', 'trial')
    `);
    const mrr = parseFloat(mrrResult?.mrr || '0');

    // Annual Recurring Revenue (ARR)
    const arr = mrr * 12;

    // Total invoices created (all time)
    const totalInvoicesResult = await db.queryOne(`
      SELECT COUNT(*) as count FROM invoices
    `);
    const totalInvoices = parseInt(totalInvoicesResult?.count || '0');

    // Invoices this month
    const invoicesThisMonthResult = await db.queryOne(`
      SELECT COUNT(*) as count 
      FROM invoices
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `);
    const invoicesThisMonth = parseInt(invoicesThisMonthResult?.count || '0');

    // New businesses this month
    const newBusinessesResult = await db.queryOne(`
      SELECT COUNT(*) as count 
      FROM businesses
      WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `);
    const newBusinessesThisMonth = parseInt(newBusinessesResult?.count || '0');

    // Trial conversions (businesses that upgraded from free)
    const trialConversionsResult = await db.queryOne(`
      SELECT COUNT(DISTINCT bs.business_id) as count
      FROM business_subscriptions bs
      WHERE bs.plan_id NOT IN ('free', 'trial')
        AND bs.status IN ('active', 'trial')
    `);
    const trialConversions = parseInt(trialConversionsResult?.count || '0');

    // Recent activities
    const recentBusinesses = await db.queryRows(`
      SELECT 
        b.id,
        b.name,
        b.email,
        b.created_at,
        bs.plan_id,
        sp.display_name as plan_name
      FROM businesses b
      LEFT JOIN business_subscriptions bs ON b.id = bs.business_id AND bs.status IN ('active', 'trial')
      LEFT JOIN subscription_plans sp ON bs.plan_id = sp.id
      ORDER BY b.created_at DESC
      LIMIT 10
    `);

    return NextResponse.json({
      metrics: {
        totalBusinesses,
        activeBusinesses,
        totalInvoices,
        invoicesThisMonth,
        newBusinessesThisMonth,
        trialConversions,
        mrr,
        arr,
      },
      subscriptionsByPlan,
      recentBusinesses,
    });
  } catch (error: any) {
    console.error('Error fetching platform metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics', details: error.message },
      { status: 500 }
    );
  }
}

