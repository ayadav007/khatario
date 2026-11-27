import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { loadReceipt, RECEIPT_HEADERS, renderReceiptHtml } from '@/lib/platform-receipt';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET — the receipt of a payment or refund of the business in the path, for a platform admin.
 * The payment must belong to that business, otherwise 404.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string; txId: string } }) {
  const auth = await requirePlatformRequest(request, 'support');
  if (!auth.ok) return auth.response;
  try {
    const receipt = await loadReceipt(params.txId, null);
    const owner = receipt
      ? await queryOne<{ ok: number }>(`SELECT 1 AS ok FROM billing_transactions WHERE id = $1::uuid AND business_id::text = $2`, [params.txId, params.id])
      : null;
    if (!receipt || !owner) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    return new NextResponse(renderReceiptHtml(receipt), { status: 200, headers: RECEIPT_HEADERS });
  } catch (error) {
    console.error('Error loading receipt:', error);
    return NextResponse.json({ error: 'Failed to load receipt' }, { status: 500 });
  }
}
