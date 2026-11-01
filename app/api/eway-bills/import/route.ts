import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { importInwardEwayBills } from '@/lib/gst/eway-inward-import';
import { authorizeEwayBill, ewayBillErrorResponse } from '@/lib/gst/eway-bill-route';

export const dynamic = 'force-dynamic';

/**
 * POST /api/eway-bills/import — { csv }: e-way bills generated against our GSTIN, from the portal.
 * Matched rows are recorded on their purchase bills; unmatched rows come back for follow-up.
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeEwayBill(request, 'update');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const csv = String(body.csv || '');
  if (!csv.trim()) return NextResponse.json({ error: 'Paste or upload the CSV' }, { status: 400 });
  if (csv.length > 5_000_000) return NextResponse.json({ error: 'The file is too large; import a month at a time' }, { status: 413 });
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await importInwardEwayBills(client, auth.businessId, csv, auth.userId);
    await client.query('COMMIT');
    return NextResponse.json(result);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return ewayBillErrorResponse(error, 'Failed to import e-way bills');
  } finally {
    client.release();
  }
}
