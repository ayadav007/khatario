import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ewayBulkJson } from '@/lib/gst/eway-json';
import { authorizeEwayBill, ewayBillErrorResponse } from '@/lib/gst/eway-bill-route';

export const dynamic = 'force-dynamic';

/**
 * GET /api/eway-bills/export?source_type=delivery_challan|invoice&source_id=&distance_km=
 * E-way bill JSON for the portal's bulk upload, as a file download.
 */
export async function GET(request: NextRequest) {
  const auth = await authorizeEwayBill(request, 'read');
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const type = sp.get('source_type');
  const id = sp.get('source_id');
  if ((type !== 'delivery_challan' && type !== 'invoice') || !id) {
    return NextResponse.json({ error: 'source_type (delivery_challan or invoice) and source_id are required' }, { status: 400 });
  }
  try {
    const json = await ewayBulkJson(getPool(), auth.businessId, type, id, { distanceKm: Number(sp.get('distance_km') ?? NaN) });
    const doc = json.billLists[0]?.docNo || 'document';
    return new NextResponse(JSON.stringify(json, null, 2), {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="ewaybill-${String(doc).replace(/[^A-Za-z0-9-]/g, '_')}.json"`,
      },
    });
  } catch (error) {
    return ewayBillErrorResponse(error, 'Failed to build e-way bill JSON');
  }
}
