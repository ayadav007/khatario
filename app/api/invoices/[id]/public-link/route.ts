import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { queryOne } from '@/lib/db';
import {
  ensureInvoicePublicToken,
  publicInvoiceUrl,
  isInvoicePubliclyViewable,
} from '@/lib/customer-surface';

/**
 * GET /api/invoices/[id]/public-link
 * Staff: get or create the customer-facing bill URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const businessScope = getSessionScopedBusinessId(request);
    if (!businessScope) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const invoice = await queryOne<{
      id: string;
      business_id: string;
      branch_id: string | null;
      status: string;
      public_token: string | null;
    }>(
      `SELECT id, business_id, branch_id, status, public_token
       FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [params.id, businessScope]
    );

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'invoices', 'read', {
        branchId: invoice.branch_id ?? undefined,
        businessId: invoice.business_id,
        resourceId: params.id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    if (!isInvoicePubliclyViewable(invoice.status)) {
      return NextResponse.json(
        {
          error: 'Public link is available after the invoice is finalized.',
          code: 'INVOICE_NOT_PUBLIC',
        },
        { status: 400 }
      );
    }

    const token =
      invoice.public_token ?? (await ensureInvoicePublicToken(invoice.id));

    return NextResponse.json({
      public_token: token,
      public_url: publicInvoiceUrl(token),
    });
  } catch (error: unknown) {
    console.error('[public-link]', error);
    return NextResponse.json({ error: 'Failed to get public link' }, { status: 500 });
  }
}
