import { NextRequest, NextResponse } from 'next/server';
import { generateInvoicePng } from '@/lib/pdf-generator';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne } from '@/lib/db';
import { getUserIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const businessScope = getSessionScopedBusinessId(req);
    if (!businessScope) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const invoice = await queryOne(
      'SELECT id, business_id, branch_id, invoice_number FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [id, businessScope]
    );

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'invoices', 'read', {
        branchId: invoice.branch_id,
        businessId: invoice.business_id,
        resourceId: id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const pngBuffer = await generateInvoicePng(id);
    const safeName = String(invoice.invoice_number ?? id).replace(/[^\w.-]+/g, '_');

    return new NextResponse(pngBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="invoice-${safeName}.png"`,
      },
    });
  } catch (error: unknown) {
    console.error('Error generating invoice image:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate image';
    const status = message === 'Invoice not found' ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
