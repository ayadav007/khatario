import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { Invoice, Customer } from '@/types/database';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';

/**
 * Send invoice via WhatsApp
 * POST /api/invoices/[id]/whatsapp
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const invoiceId = params.id;
    const body = await request.json();
    const { pdf_url, custom_message } = body;

    const businessScope = getSessionScopedBusinessId(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get invoice with customer details
    const invoice = await queryOne<Invoice & { customer_phone?: string; business_id: string }>(`
      SELECT 
        i.*,
        c.phone as customer_phone,
        i.business_id
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL
    `, [invoiceId, businessScope]);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (!invoice.customer_phone) {
      return NextResponse.json(
        { error: 'Customer phone number not found' },
        { status: 400 }
      );
    }

    if (!pdf_url) {
      return NextResponse.json(
        { error: 'PDF URL is required' },
        { status: 400 }
      );
    }

    // Send via WhatsApp
    const message = custom_message || `Hello! Please find your invoice ${invoice.invoice_number} attached.`;
    
    try {
      await sendWhatsAppMessage(
        invoice.business_id,
        invoice.customer_phone,
        message,
        pdf_url,
        'document'
      );

      return NextResponse.json({
        success: true,
        message: 'Invoice sent successfully via WhatsApp',
      });
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Failed to send WhatsApp message' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error sending invoice via WhatsApp:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

