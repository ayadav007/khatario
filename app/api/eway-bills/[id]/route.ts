import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getEwayBill, updateEwayBill, type EwayBillAction } from '@/lib/gst/eway-bill-records';
import { authorizeEwayBill, ewayBillErrorResponse } from '@/lib/gst/eway-bill-route';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authorizeEwayBill(request, 'read');
  if (!auth.ok) return auth.response;
  try {
    const eway_bill = await getEwayBill(getPool(), auth.businessId, params.id);
    if (!eway_bill) return NextResponse.json({ error: 'E-way bill not found' }, { status: 404 });
    return NextResponse.json({ eway_bill });
  } catch (error) {
    return ewayBillErrorResponse(error, 'Failed to load e-way bill');
  }
}

/** PATCH /api/eway-bills/[id] — { action: 'cancel' | 'reject' | 'close' | 'extend' | 'vehicle', ... } */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await authorizeEwayBill(request, 'update');
  if (!auth.ok) return auth.response;
  const client = await getPool().connect();
  try {
    const body = (await request.json().catch(() => ({}))) as EwayBillAction;
    await client.query('BEGIN');
    const eway_bill = await updateEwayBill(client, auth.businessId, params.id, body, auth.userId);
    await client.query('COMMIT');
    return NextResponse.json({ eway_bill });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return ewayBillErrorResponse(error, 'Failed to update e-way bill');
  } finally {
    client.release();
  }
}
