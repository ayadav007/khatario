import { NextRequest, NextResponse } from 'next/server';
import { authorizeInvoiceHistory, loadInvoiceHistory } from '@/lib/invoices/invoice-history';

export const dynamic = 'force-dynamic';

/**
 * GET /api/invoices/[id]/history?limit=100
 * The invoice's edit log: every saved version, newest first, with what changed, who changed it
 * and why (invoice_revisions, migration 469), then activity logged before history started.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const access = await authorizeInvoiceHistory(request, params.id);
    if (access instanceof NextResponse) return access;

    const limitParam = Number(new URL(request.url).searchParams.get('limit') ?? '100');
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 500) : 100;

    const history = await loadInvoiceHistory(access.businessId, params.id, limit);
    return NextResponse.json({ history });
  } catch (error) {
    console.error('Error fetching invoice history', error);
    return NextResponse.json({ error: 'Could not load the invoice history' }, { status: 500 });
  }
}
