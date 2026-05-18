import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

/**
 * GET /api/stock-requests/summary
 * Tenant = authenticated business only.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const businessId = auth.businessId;

    const requester = await db.queryOne(
      `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status IN ('confirmed','partial')) AS confirmed,
        COUNT(*) FILTER (WHERE status = 'backorder') AS backorder
      FROM quantity_requests
      WHERE requester_business_id = $1
      `,
      [businessId]
    );

    const responder = await db.queryOne(
      `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status IN ('confirmed','partial')) AS confirmed,
        COUNT(*) FILTER (WHERE status = 'backorder') AS backorder
      FROM quantity_requests
      WHERE responder_business_id = $1
      `,
      [businessId]
    );

    return NextResponse.json({
      requester: requester || {},
      responder: responder || {},
    });
  } catch (error: any) {
    console.error('Error fetching stock request summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch summary', details: error.message },
      { status: 500 }
    );
  }
}
