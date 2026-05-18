import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

/**
 * GET /api/stock-requests/[id]/events
 * Activity log for one quantity request (requester or responder only).
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const qr = await db.queryOne<{
      id: string;
      requester_business_id: string;
      responder_business_id: string;
    }>(
      `SELECT id, requester_business_id, responder_business_id FROM quantity_requests WHERE id = $1`,
      [params.id]
    );

    if (!qr) {
      return NextResponse.json({ error: 'request not found' }, { status: 404 });
    }

    if (qr.requester_business_id !== auth.businessId && qr.responder_business_id !== auth.businessId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const events = await db.queryRows(
      `
      SELECT id, event_type, payload, actor_user_id, business_id, created_at
      FROM quantity_request_events
      WHERE quantity_request_id = $1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [params.id]
    );

    return NextResponse.json({ events });
  } catch (error: any) {
    console.error('Error fetching quantity request events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events', details: error.message },
      { status: 500 }
    );
  }
}
