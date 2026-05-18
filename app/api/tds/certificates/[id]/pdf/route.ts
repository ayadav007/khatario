import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 1. Fetch Certificate Data
    const certificate = await db.queryOne(
      `SELECT tc.*, 
        c.name as party_name, c.pan as party_pan,
        b.name as business_name, b.address_line1 as business_address, b.city as business_city, b.state as business_state, b.tan as business_tan, b.pan as business_pan
       FROM tds_certificates tc
       LEFT JOIN customers c ON tc.party_id = c.id
       JOIN businesses b ON tc.business_id = b.id
       WHERE tc.id = $1`,
      [id]
    );

    if (!certificate) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 });
    }

    const templateData = {
      certificate: {
        ...certificate,
        payment_date: new Date(certificate.payment_date).toLocaleDateString('en-IN'),
        tax_amount: Number(certificate.tax_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        gross_amount: Number(certificate.gross_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        nature: certificate.nature_of_payment || 'N/A',
        section: certificate.section_code || 'N/A'
      },
      business: {
        name: certificate.business_name,
        address: certificate.business_address,
        city: certificate.business_city,
        state: certificate.business_state,
        tan: certificate.business_tan,
        pan: certificate.business_pan
      },
      settings: { primary_color: '#000000' }
    };

    const renderer = new InvoiceRenderer();
    let html = await renderer.renderHtml('tds_certificate', templateData as any);
    const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
    html = await maybeAppendKhatarioPrintFooter(html, certificate.business_id);

    // Generate PDF with Puppeteer
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
        'Content-Disposition': `attachment; filename="TDS-Certificate-${certificate.certificate_number}.pdf"`,
      },
    });

  } catch (error: any) {
    console.error('Error generating TDS certificate:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

