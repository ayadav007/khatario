import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    const transactions = await queryRows(
      `SELECT * FROM billing_transactions
       WHERE business_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [businessId]
    );

    const events = await queryRows(
      `SELECT * FROM subscription_events
       WHERE business_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [businessId]
    );

    return NextResponse.json({ transactions, events });
  } catch (error: any) {
    console.error('Error fetching billing history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch billing history', details: error.message },
      { status: 500 }
    );
  }
}
