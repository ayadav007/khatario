import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { InvoiceRenderer } from '@/lib/invoice-renderer';

export async function GET(
  req: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const { accountId } = params;
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get('business_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

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

    // 3. Fetch Ledger Entries
    const entriesRes = await db.queryRows(
      `SELECT 
        l.entry_date,
        l.description as particulars,
        l.voucher_number as voucher,
        l.debit,
        l.credit,
        SUM(l.debit - l.credit) OVER (ORDER BY l.entry_date, l.created_at) as running_balance
       FROM ledger_entries l
       WHERE l.account_id = $1 AND l.business_id = $2
       AND l.entry_date >= $3 AND l.entry_date <= $4
       ORDER BY l.entry_date, l.created_at`,
      [accountId, businessId, fromDate, toDate]
    );

    // Calculate Opening Balance
    const obRes = await db.queryOne(
      `SELECT COALESCE(SUM(debit - credit), 0) as ob
       FROM ledger_entries
       WHERE account_id = $1 AND business_id = $2
       AND entry_date < $3`,
      [accountId, businessId, fromDate]
    );
    const openingBalance = Number(obRes.ob);

    let currentBalance = openingBalance;
    const formattedEntries = entriesRes.map(e => {
      currentBalance += (Number(e.debit) - Number(e.credit));
      return {
        date: new Date(e.entry_date).toLocaleDateString('en-IN'),
        particulars: e.particulars,
        voucher: e.voucher,
        debit: Number(e.debit) > 0 ? Number(e.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '',
        credit: Number(e.credit) > 0 ? Number(e.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '',
        balance: currentBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })
      };
    });

    const totalDebit = entriesRes.reduce((sum, e) => sum + Number(e.debit), 0);
    const totalCredit = entriesRes.reduce((sum, e) => sum + Number(e.credit), 0);

    const templateData = {
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

    return NextResponse.json({ html });

  } catch (error: any) {
    console.error('Error generating statement:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

