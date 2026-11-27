import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getEwayBill, type EwayBillAction } from '@/lib/gst/eway-bill-records';
import { applyEwayBillAction } from '@/lib/gst/eway-gsp-actions';
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

/** PATCH /api/eway-bills/[id]: { action: 'cancel' | 'reject' | 'close' | 'extend' | 'vehicle', ... } */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await authorizeEwayBill(request, 'update');
  if (!auth.ok) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as EwayBillAction;
    const eway_bill = await applyEwayBillAction(auth.businessId, auth.userId, params.id, body);
    return NextResponse.json({ eway_bill });
  } catch (error) {
    return ewayBillErrorResponse(error, 'Failed to update e-way bill');
  }
}
