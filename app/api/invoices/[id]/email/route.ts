import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { sendInvoiceEmail } from '@/lib/email';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import { prepareInvoiceForRendering } from '@/lib/invoice-presenter';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { getUserIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * POST /api/invoices/[id]/email
 * Send invoice via email
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const invoiceId = params.id;

    const businessScope = getSessionScopedBusinessId(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { recipient_email, recipient_name } = body;

    if (!recipient_email) {
      return NextResponse.json(
        { error: 'recipient_email is required' },
        { status: 400 }
      );
    }

    // Fetch invoice data — tenant-scoped (no cross-business access by guessing UUID)
    const invoice = await db.queryOne(`
      SELECT 
        i.*,
        c.name as customer_name,
        c.email as customer_email,
        c.phone as customer_phone,
        c.address as customer_address,
        c.gstin as customer_gstin,
        b.name as business_name,
        b.email as business_email,
        b.phone as business_phone,
        b.address_line1 as business_address,
        b.city as business_city,
        b.state as business_state,
        b.pincode as business_pincode,
        b.gstin as business_gstin,
        b.logo_url as business_logo
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      LEFT JOIN businesses b ON i.business_id = b.id
      WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL
    `, [invoiceId, businessScope]);
    if (!invoice) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
    const accessCheck = await checkEmployeeAccessBoundary(userId, 'portal');
    if (!accessCheck.allowed) {
      return NextResponse.json(
        { error: accessCheck.reason, code: 'ACCESS_DENIED' },
        { status: 403 }
      );
    }

    try {
      await authorize(userId, 'invoices', 'update', {
        branchId: invoice.branch_id,
        businessId: invoice.business_id,
        resourceId: invoiceId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(invoice.business_id, FeatureKeys.EMAIL_INVOICING);
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch invoice items
    const items = await db.queryRows(`
      SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order
    `, [invoiceId]);

    // Get template settings from business_template_assignments
    const assignmentResult = await db.queryOne(`
      SELECT template_id, settings FROM business_template_assignments 
      WHERE business_id = $1 AND document_type = 'tax_invoice'
      LIMIT 1
    `, [invoice.business_id]);

    let settings = assignmentResult?.settings || {};
    if (typeof settings === 'string') {
      settings = JSON.parse(settings);
    }

    const templateId = invoice.template_id || assignmentResult?.template_id || 'gst_standard';

    // Prepare data for rendering
    const renderData = await prepareInvoiceForRendering({
      invoice: {
        ...invoice,
        items,
      },
      business: {
        id: invoice.business_id,
        name: invoice.business_name,
        email: invoice.business_email,
        phone: invoice.business_phone,
        address: invoice.business_address,
        city: invoice.business_city,
        state: invoice.business_state,
        pincode: invoice.business_pincode,
        gstin: invoice.business_gstin,
        logo_url: invoice.business_logo,
      },
      customer: {
        name: invoice.customer_name,
        email: invoice.customer_email,
        phone: invoice.customer_phone,
        address: invoice.customer_address,
        gstin: invoice.customer_gstin,
      },
      items: items,
    }, settings);

    // Generate HTML using InvoiceRenderer
    const renderer = new InvoiceRenderer();
    let html = await renderer.renderHtml(templateId, renderData);
    const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
    html = await maybeAppendKhatarioPrintFooter(html, invoice.business_id);

    // Generate PDF using Puppeteer
    const browser = await puppeteer.launch(
      getPuppeteerLaunchOptions({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    );

    const page = await browser.newPage();
    await page.setContent(html);
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    await browser.close();

    let onlineViewUrl: string | null = null;
    if (invoice.status === 'final') {
      try {
        const { ensureInvoicePublicToken, publicInvoiceUrl, isInvoicePubliclyViewable } =
          await import('@/lib/customer-surface');
        if (isInvoicePubliclyViewable(invoice.status)) {
          const token = await ensureInvoicePublicToken(invoiceId);
          onlineViewUrl = publicInvoiceUrl(token);
        }
      } catch (linkErr) {
        console.error('[invoice email] public link (non-fatal):', linkErr);
      }
    }

    // Send email
    const sent = await sendInvoiceEmail(
      invoice.business_id,
      recipient_email,
      recipient_name || invoice.customer_name,
      invoice.invoice_number,
      Buffer.from(pdfBuffer),
      invoice.business_name,
      onlineViewUrl
    );

    if (!sent) {
      return NextResponse.json(
        {
          error:
            'Failed to send email. Configure SMTP under Settings → Email for your business.',
          code: 'EMAIL_NOT_CONFIGURED',
        },
        { status: 500 }
      );
    }

    // Log the email sending activity
    // TODO: Create email_logs table and store the activity

    return NextResponse.json({
      success: true,
      message: 'Invoice sent successfully via email',
    });
  } catch (error: any) {
    console.error('Error sending invoice email:', error);
    return NextResponse.json(
      { error: 'Failed to send email', details: error.message },
      { status: 500 }
    );
  }
}

