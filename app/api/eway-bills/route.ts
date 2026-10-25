import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { parseEwayBillInput } from '@/lib/gst/eway-bills';
import { createEwayBill, listEwayBills } from '@/lib/gst/eway-bill-records';
import { authorizeEwayBill, ewayBillErrorResponse } from '@/lib/gst/eway-bill-route';

export const dynamic = 'force-dynamic';

/** GET /api/eway-bills?source_type=&source_id=&status=&expiring_within_hours= */
export async function GET(request: NextRequest) {
  const auth = await authorizeEwayBill(request, 'read');
  if (!auth.ok) return auth.response;
  try {
    const sp = request.nextUrl.searchParams;
    const hours = sp.get('expiring_within_hours');
    const eway_bills = await listEwayBills(getPool(), auth.businessId, {
      sourceType: sp.get('source_type'),
      sourceId: sp.get('source_id'),
      status: sp.get('status'),
      expiringWithinHours: hours ? Number(hours) : null,
    });
    return NextResponse.json({ eway_bills });
  } catch (error) {
    return ewayBillErrorResponse(error, 'Failed to load e-way bills');
  }
}

/** POST /api/eway-bills — record an e-way bill generated on the portal, linked to its document. */
export async function POST(request: NextRequest) {
  const auth = await authorizeEwayBill(request, 'update');
  if (!auth.ok) return auth.response;
  const client = await getPool().connect();
  try {
    const parsed = parseEwayBillInput(await request.json().catch(() => ({})));
    await client.query('BEGIN');
    const eway_bill = await createEwayBill(client, auth.businessId, parsed, auth.userId);
    await client.query('COMMIT');
    return NextResponse.json({ eway_bill }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return ewayBillErrorResponse(error, 'Failed to record e-way bill');
  } finally {
    client.release();
  }
}
