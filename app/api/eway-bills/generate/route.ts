import { NextRequest, NextResponse } from 'next/server';
import { generateEwayBillViaGsp } from '@/lib/gst/eway-generate';
import { authorizeEwayBill, ewayBillErrorResponse } from '@/lib/gst/eway-bill-route';

export const dynamic = 'force-dynamic';

/** POST /api/eway-bills/generate: generate an e-way bill through Masters India and record it. */
export async function POST(request: NextRequest) {
  const auth = await authorizeEwayBill(request, 'update');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const eway_bill = await generateEwayBillViaGsp(auth.businessId, auth.userId, body);
    return NextResponse.json({ eway_bill }, { status: 201 });
  } catch (error) {
    return ewayBillErrorResponse(error, 'Failed to generate e-way bill');
  }
}
