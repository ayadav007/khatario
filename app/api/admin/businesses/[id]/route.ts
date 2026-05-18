import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

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
        bs.id as subscription_id,
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
      LEFT JOIN business_subscriptions bs ON b.id = bs.business_id
      LEFT JOIN subscription_plans sp ON bs.plan_id = sp.id
      WHERE b.id = $1
    `, [businessId]);

    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ business });
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
 * Delete a business and all associated data (CASCADE)
 * WARNING: This is a destructive operation that will delete all related data
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_businesses');
    if (!auth.ok) return auth.response;

    const businessId = params.id;

    // Verify business exists
    const existing = await db.queryOne(`
      SELECT id, name FROM businesses WHERE id = $1
    `, [businessId]);

    if (!existing) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    // Delete business (CASCADE will handle all related data)
    // Note: This will delete:
    // - All users, customers, suppliers, items
    // - All invoices, purchases, expenses
    // - All subscriptions, addons
    // - All ledger entries, journal entries
    // - All other business-related data
    await db.query(`
      DELETE FROM businesses WHERE id = $1
    `, [businessId]);

    console.log(`Business ${businessId} (${existing.name}) deleted successfully`);

    return NextResponse.json({ 
      success: true,
      message: 'Business deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting business:', error);
    return NextResponse.json(
      { error: 'Failed to delete business', details: error.message },
      { status: 500 }
    );
  }
}
