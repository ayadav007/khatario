import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { queryOne, queryRows } from '@/lib/db';
import { checkLimit } from '@/lib/subscription';

/**
 * GET /api/subscriptions/debug
 * Debug endpoint — development only; uses authenticated business from session (no cross-tenant query param).
 */
export async function GET(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    const subscription = await queryOne(
      `
      SELECT 
        bs.id,
        bs.business_id,
        bs.plan_id,
        bs.status,
        sp.display_name as plan_name,
        sp.features
      FROM business_subscriptions bs
      JOIN subscription_plans sp ON bs.plan_id = sp.id
      WHERE bs.business_id = $1
      LIMIT 1
    `,
      [businessId]
    );

    const invoiceCount = await queryOne(
      `
      SELECT COUNT(*) as count
      FROM invoices
      WHERE business_id = $1 
        AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `,
      [businessId]
    );

    const totalInvoices = await queryOne(
      `
      SELECT COUNT(*) as count
      FROM invoices
      WHERE business_id = $1
    `,
      [businessId]
    );

    const limitCheck = await checkLimit(businessId, 'invoices');

    const recentInvoices = await queryRows(
      `
      SELECT 
        invoice_number,
        status,
        document_type,
        created_at::date as created_date
      FROM invoices
      WHERE business_id = $1
        AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
      ORDER BY created_at DESC
      LIMIT 10
    `,
      [businessId]
    );

    return NextResponse.json({
      business_id: businessId,
      subscription: subscription || null,
      invoice_counts: {
        this_month: parseInt(invoiceCount?.count || '0'),
        total: parseInt(totalInvoices?.count || '0'),
      },
      limit_check: limitCheck,
      recent_invoices_this_month: recentInvoices,
    });
  } catch (error: any) {
    console.error('Debug error:', error);
    return NextResponse.json(
      { error: 'Debug failed', details: error.message },
      { status: 500 }
    );
  }
}
