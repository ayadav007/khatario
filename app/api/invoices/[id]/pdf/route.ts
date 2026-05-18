import { NextRequest, NextResponse } from 'next/server';
import { generateInvoicePdf } from '@/lib/pdf-generator';
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

    // Tenant-scoped: only invoice rows for JWT active business
    const invoice = await queryOne(
      'SELECT id, business_id, branch_id FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [id, businessScope]
    );

    if (!invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'invoices', 'read', {
        branchId: invoice.branch_id,
        businessId: invoice.business_id,
        resourceId: id
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }
    
    // Use the shared generator which fetches data, renders HTML, and creates PDF buffer
    const pdfBuffer = await generateInvoicePdf(id);

    return new NextResponse(pdfBuffer as any, {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="invoice-${id}.pdf"`,
        }
    });

  } catch (error: any) {
    console.error('Error generating PDF:', error);
    const status = error.message === 'Invoice not found' ? 404 : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to generate PDF' },
      { status }
    );
  }
}
