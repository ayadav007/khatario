import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { deleteBusinessCompletely, getBusinessModuleSubscriptions } from '@/lib/admin-business-ops';
import { getBusinessPlatformContext } from '@/lib/business-modules';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/businesses/[id]
 * Get detailed information about a specific business
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_businesses');
    if (!auth.ok) return auth.response;

    const businessId = params.id;

    // Get business with subscription info
    const business = await db.queryOne(`
      SELECT 
        b.id,
        b.name,
        b.email,
        b.phone,
        b.address_line1,
        b.address_line2,
        b.city,
        b.state,
        b.state_code,
        b.pincode,
        b.gstin,
        b.pan,
        b.currency,
        b.invoice_prefix,
        b.created_at,
        b.platform_suspended_at,
        b.platform_suspend_reason,
        COALESCE(b.primary_module, 'billing') as primary_module,
        bs.module_key,
        bs.plan_id,
        bs.status as subscription_status,
        bs.start_date as subscription_start_date,
        bs.end_date as subscription_end_date,
        bs.trial_end_date,
        bs.billing_cycle,
        bs.grace_period_end,
        bs.cancel_at_period_end,
        sp.display_name as plan_name,
        sp.price_monthly,
        (SELECT COUNT(*) FROM invoices WHERE business_id = b.id) as invoice_count,
        (SELECT COUNT(*) FROM customers WHERE business_id = b.id) as customer_count,
        (SELECT COUNT(*) FROM items WHERE business_id = b.id) as item_count,
        (SELECT COUNT(*) FROM users WHERE business_id = b.id) as user_count,
        (SELECT MAX(created_at) FROM invoices WHERE business_id = b.id) as last_invoice_date
      FROM businesses b
      LEFT JOIN business_module_subscriptions bs
        ON bs.business_id = b.id
       AND bs.module_key = COALESCE(b.primary_module, 'billing')
      LEFT JOIN subscription_plans sp ON bs.plan_id = sp.id
      WHERE b.id = $1
    `, [businessId]);

    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    const [moduleSubscriptions, platform] = await Promise.all([
      getBusinessModuleSubscriptions(businessId),
      getBusinessPlatformContext(businessId),
    ]);

    return NextResponse.json({
      business: {
        ...business,
        enabled_modules: platform.enabledModules,
        module_subscriptions: moduleSubscriptions,
      },
    });
  } catch (error: any) {
    console.error('Error fetching business:', error);
    return NextResponse.json(
      { error: 'Failed to fetch business', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/businesses/[id]
 * Permanently delete a business and cascaded tenant data.
 * Body (optional): { confirmName: string } — must match business name exactly.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'admin', 'can_manage_businesses');
    if (!auth.ok) return auth.response;

    const businessId = params.id;

    const existing = await db.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM businesses WHERE id = $1`,
      [businessId],
    );

    if (!existing) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    let confirmName: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.confirmName === 'string') {
        confirmName = body.confirmName;
      }
    } catch {
      /* no body — still allow if older clients omit it */
    }

    if (confirmName !== undefined && confirmName.trim() !== existing.name.trim()) {
      return NextResponse.json(
        { error: 'Confirmation name does not match business name' },
        { status: 400 },
      );
    }

    const deleted = await deleteBusinessCompletely(businessId, auth.admin.id);
    console.log(`Business ${businessId} (${deleted.name}) deleted successfully`);

    return NextResponse.json({
      success: true,
      message: 'Business deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting business:', error);
    const message = error?.message || 'Failed to delete business';
    const status = message === 'Business not found' ? 404 : 500;
    return NextResponse.json({ error: message, details: message }, { status });
  }
}
