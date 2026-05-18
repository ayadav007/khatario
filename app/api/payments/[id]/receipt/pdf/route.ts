import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import { prepareInvoiceForRendering } from '@/lib/invoice-presenter';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

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

    const paymentRow = await db.queryOne<{
      business_id: string;
      branch_id: string | null;
      [key: string]: unknown;
    }>(
      `SELECT p.*, 
        c.name as party_name,
        b.name as business_name, b.address_line1 as business_address, b.city as business_city, b.state as business_state, b.pincode as business_pincode
       FROM payments p
       LEFT JOIN customers c ON p.customer_id = c.id AND c.deleted_at IS NULL
       JOIN businesses b ON p.business_id = b.id
       WHERE p.id = $1 AND p.business_id = $2 AND p.deleted_at IS NULL`,
      [id, businessScope]
    );

    if (!paymentRow) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'payments', 'read', {
        resourceId: id,
        branchId: paymentRow.branch_id || undefined,
        businessId: paymentRow.business_id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const payment = paymentRow;

    // 2. Transform for template
    const renderData = await prepareInvoiceForRendering({
      invoice: {
        invoice_number: payment.reference_number || 'N/A',
        invoice_date: payment.payment_date,
        grand_total: payment.amount,
        subtotal: payment.amount,
        document_type: 'tax_invoice' // dummy
      },
      business: payment,
      customer: { name: payment.party_name },
      items: []
    }, { primary_color: '#3b82f6' });

    const templateData = {
      payment: {
        ...payment,
        date: new Date(String(payment.payment_date)).toLocaleDateString('en-IN'),
        amount: Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        amount_in_words: renderData.invoice.amount_in_words,
        party_name: payment.party_name,
        reference_number: payment.reference_number
      },
      business: {
        name: payment.business_name,
        address: `${payment.business_address}, ${payment.business_city}`
      },
      settings: { primary_color: '#3b82f6' }
    };

    const renderer = new InvoiceRenderer();
    let html = await renderer.renderHtml('payment_receipt', templateData as any);
    const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
    html = await maybeAppendKhatarioPrintFooter(html, payment.business_id);

    // 3. Generate PDF
    const browser = await puppeteer.launch(
      getPuppeteerLaunchOptions({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    );
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    return new NextResponse(pdfBuffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Receipt-${payment.reference_number || id}.pdf"`,
      },
    });

  } catch (error: any) {
    console.error('Error downloading receipt:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

