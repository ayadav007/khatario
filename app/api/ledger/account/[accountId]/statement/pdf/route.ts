import { NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { listLedgerRegister, signedLedgerBalance, sumLedgerRegister } from '@/lib/accounting/ledger-register';
import { InvoiceRenderer } from '@/lib/invoice-renderer';
import puppeteer from 'puppeteer';
import { getPuppeteerLaunchOptions } from '@/lib/puppeteer-launch';
import { withPremiumSubscriptionApi } from '@/lib/security';

export const dynamic = 'force-dynamic';

export const GET = withPremiumSubscriptionApi<{ accountId: string }>(
  { module: 'report.financial', action: 'read',},
  async (ctx) => {
    try {
      const { accountId } = ctx.params;
      const { searchParams } = new URL(ctx.request.url);
      const businessId = ctx.businessId;
      const fromDate = searchParams.get('from_date');
      const toDate = searchParams.get('to_date');

      // 1. Fetch Account Data
      const account = await db.queryOne(
        `SELECT a.* FROM accounts a WHERE a.id = $1 AND a.business_id = $2`,
        [accountId, businessId]
      );

      if (!account) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      }

      // 2. Fetch Business Info
      const business = await db.queryOne(
        `SELECT b.name, b.address_line1 as address, b.city FROM businesses b WHERE b.id = $1`,
        [businessId]
      );

      const { entries: entriesRes } = await listLedgerRegister({
        businessId,
        accountId,
        fromDate,
        toDate,
        order: 'asc',
        limit: null,
      });
      const prior = fromDate
        ? await sumLedgerRegister({ businessId, accountId, beforeDate: fromDate })
        : { debit: 0, credit: 0 };
      const openingBalance = signedLedgerBalance(account.nature, prior.debit, prior.credit);

      let currentBalance = openingBalance;
      const formattedEntries = entriesRes.map(e => {
        const debit = Number(e.debit);
        const credit = Number(e.credit);
        currentBalance += signedLedgerBalance(account.nature, debit, credit);
        return {
          date: new Date(e.entry_date).toLocaleDateString('en-IN'),
          particulars: e.narration,
          voucher: e.voucher_number || e.reference_number,
          debit: debit > 0 ? debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '',
          credit: credit > 0 ? credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '',
          balance: currentBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })
        };
      });

      const totalDebit = entriesRes.reduce((sum, e) => sum + Number(e.debit), 0);
      const totalCredit = entriesRes.reduce((sum, e) => sum + Number(e.credit), 0);

      const templateData = {
        business_id: businessId,
        account,
        business,
        period: { from: fromDate, to: toDate },
        entries: formattedEntries,
        opening_balance: openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        closing_balance: currentBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        total_debit: totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        total_credit: totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
        settings: { primary_color: '#3b82f6' }
      };

      const renderer = new InvoiceRenderer();
      let html = await renderer.renderHtml('account_statement', templateData as any);
      const { maybeAppendKhatarioPrintFooter } = await import('@/lib/print-branding');
      html = await maybeAppendKhatarioPrintFooter(html, businessId);

      // Generate PDF
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
          'Content-Disposition': `attachment; filename="Statement-${account.name || accountId}.pdf"`,
        },
      });

    } catch (error: any) {
      console.error('Error downloading statement:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
