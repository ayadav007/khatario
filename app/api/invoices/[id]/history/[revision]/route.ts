import { NextRequest, NextResponse } from 'next/server';
import { authorizeInvoiceHistory, loadInvoiceRevision } from '@/lib/invoices/invoice-history';

export const dynamic = 'force-dynamic';

/**
 * GET /api/invoices/[id]/history/[revision]
 * One saved version of the invoice: its full snapshot (header, lines, charges).
 */
export async function GET(request: NextRequest, { params }: { params: { id: string; revision: string } }) {
  try {
    const access = await authorizeInvoiceHistory(request, params.id);
    if (access instanceof NextResponse) return access;

    const revisionNo = /^\d{1,9}$/.test(params.revision) ? Number(params.revision) : NaN;
    const revision = Number.isFinite(revisionNo)
      ? await loadInvoiceRevision(access.businessId, params.id, revisionNo)
      : null;
    if (!revision) {
      return NextResponse.json({ error: 'That version was not found', code: 'REVISION_NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json(revision);
  } catch (error) {
    console.error('Error fetching invoice revision', error);
    return NextResponse.json({ error: 'Could not load that version' }, { status: 500 });
  }
}
