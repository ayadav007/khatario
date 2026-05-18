import { NextRequest, NextResponse } from 'next/server';
import { finalizePrintHtml, generateInvoiceHtml } from '@/lib/pdf-generator';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const userId = getUserIdFromRequest(req);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getBusinessIdFromRequest(req);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Fetch invoice to get branch_id for authorization (tenant-scoped; exclude soft-deleted)
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

    const { html, templateId, settings, businessId } = await generateInvoiceHtml(id);
    const finalizedHtml = await finalizePrintHtml(html, templateId, settings, businessId);

    return NextResponse.json({ html: finalizedHtml, templateId });

  } catch (error: any) {
    console.error('Error generating invoice preview:', error);
    console.error('Error stack:', error.stack);
    const status = error.message === 'Invoice not found' ? 404 : 500;
    return NextResponse.json(
      { 
        error: error.message || 'Failed to generate preview',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status }
    );
  }
}

