import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { loadAccessibleExpense } from '@/lib/hr/expense-access';
import { renderExpenseVoucherHtml } from '@/lib/hr/expense-voucher';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/expenses/[id]/voucher/pdf
 * Same access rules as the HTML voucher. Nothing is rendered, and no browser is launched,
 * until the caller is authenticated and the expense is confirmed to be theirs.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const access = await loadAccessibleExpense(req, params.id, 'read');
    if (!access.ok) return access.response;
    const { expense } = access;

    const html = await renderExpenseVoucherHtml(expense);

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
      return new NextResponse(pdfBuffer as any, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Voucher-${expense.id.substring(0, 8)}.pdf"`,
        },
      });
    } finally {
      await browser.close();
    }
  } catch (error: any) {
    console.error('Error downloading expense voucher:', error);
    return NextResponse.json({ error: 'Failed to generate voucher PDF' }, { status: 500 });
  }
}
