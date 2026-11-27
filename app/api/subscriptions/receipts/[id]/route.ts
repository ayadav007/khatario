import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { loadReceipt, RECEIPT_HEADERS, renderReceiptHtml } from '@/lib/platform-receipt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/subscriptions/receipts/{payment id}
 * The receipt (or tax invoice, refund receipt, credit note) of one completed payment or completed refund,
 * as an HTML page. The business is the signed-in session's, as in billing history; a payment of another
 * business answers 404, exactly like one that does not exist.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const tenant = requireTenantBusinessId(request);
  if (!tenant.ok) return tenant.response;
  try {
    const receipt = await loadReceipt(params.id, tenant.businessId);
    if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    return new NextResponse(renderReceiptHtml(receipt), { status: 200, headers: RECEIPT_HEADERS });
  } catch (error) {
    console.error('Error loading receipt:', error);
    return NextResponse.json({ error: 'Failed to load receipt' }, { status: 500 });
  }
}
