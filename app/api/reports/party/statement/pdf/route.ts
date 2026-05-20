import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { buildCustomerStatementHtml, type PartyStatementPrintPayload } from '@/lib/party-statement-print';
import { GET as getStatementJson } from '../route';

function safeFileName(name: string): string {
  return (name || 'statement').replace(/[^\w.-]+/g, '_').slice(0, 80);
}

/**
 * GET /api/reports/party/statement/pdf
 * Generates a PDF attachment for party statement (customer/supplier).
 *
 * Query params: same as /api/reports/party/statement
 */
export async function GET(request: NextRequest) {
  try {
    const jsonRes = await getStatementJson(request);
    if (!jsonRes.ok) {
      // Forward errors (auth, validation, access control)
      return jsonRes;
    }

    const data = (await jsonRes.json()) as any;

    const payload: PartyStatementPrintPayload = {
      businessName: data?.business?.name || 'Business',
      businessPhone: data?.business?.phone ?? null,
      partyName: data?.party?.name || 'Party',
      partyPhone: data?.party?.phone ?? null,
      fromDate: String(data?.from_date || ''),
      toDate: String(data?.to_date || ''),
      openingBalance: Number(data?.opening_balance || 0),
      closingBalance: Number(data?.closing_balance || 0),
      transactions: Array.isArray(data?.transactions) ? data.transactions : [],
    };

    const html = buildCustomerStatementHtml(payload);

    const browser = await puppeteer.launch(
      getPuppeteerLaunchOptions({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    );
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });

      const filename = `${safeFileName(payload.partyName)}_${payload.fromDate}_${payload.toDate}.pdf`;
      return new NextResponse(pdfBuffer as any, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="party-statement-${filename}"`,
        },
      });
    } finally {
      await browser.close();
    }
  } catch (error: any) {
    console.error('Error generating party statement PDF:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

