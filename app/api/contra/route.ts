import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryRows } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import { buildContraLines, listCashBankAccounts, postContraVoucher } from '@/lib/accounting/contra';

export const dynamic = 'force-dynamic';

/**
 * GET /api/contra — contra vouchers plus the cash/bank accounts eligible for one.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await guardLedgerRoute(request, {
      claimedBusinessId: searchParams.get('business_id'),
      action: 'read',
    });
    if (!guard.ok) return guard.response;
    const { businessId } = guard;

    const from = searchParams.get('from_date');
    const to = searchParams.get('to_date');
    const params: unknown[] = [businessId];
    let where = `lel.business_id = $1 AND lel.voucher_type = 'contra'`;
    if (from) {
      params.push(from);
      where += ` AND lel.entry_date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      where += ` AND lel.entry_date <= $${params.length}`;
    }

    const vouchers = await queryRows(
      `SELECT lel.voucher_id,
              je.voucher_number,
              lel.entry_date,
              je.reference_number,
              je.narration,
              je.tags,
              MAX(CASE WHEN lel.debit > 0 THEN a.account_name END) AS to_account,
              MAX(CASE WHEN lel.credit > 0 THEN a.account_name END) AS from_account,
              SUM(lel.debit) AS amount
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
         LEFT JOIN journal_entries je ON je.voucher_id = lel.voucher_id AND je.business_id = lel.business_id
        WHERE ${where}
        GROUP BY lel.voucher_id, je.voucher_number, lel.entry_date, je.reference_number, je.narration, je.tags
        ORDER BY lel.entry_date DESC, je.voucher_number DESC
        LIMIT 500`,
      params
    );

    const client = await getPool().connect();
    try {
      const accounts = await listCashBankAccounts(client, businessId);
      return NextResponse.json({ vouchers, accounts });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error listing contra vouchers:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/contra — cash deposit, cash withdrawal or bank-to-bank transfer.
 * Body: { entry_date, from_account_id, to_account_id, amount, reference_number?, narration?, branch_id? }
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const entryDate = typeof body?.entry_date === 'string' ? body.entry_date.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    return NextResponse.json({ error: 'entry_date (YYYY-MM-DD) is required' }, { status: 400 });
  }

  const guard = await guardLedgerRoute(request, {
    claimedBusinessId: body.business_id,
    branchId: body.branch_id,
    action: 'create',
    dates: [entryDate],
    actionLabel: 'post a contra entry',
  });
  if (!guard.ok) return guard.response;
  const { businessId, userId, branchId } = guard;

  const client = await getPool().connect();
  try {
    const accounts = await listCashBankAccounts(client, businessId);
    const built = buildContraLines(
      {
        fromAccountId: String(body.from_account_id || ''),
        toAccountId: String(body.to_account_id || ''),
        amount: Number(body.amount),
        narration: body.narration,
      },
      accounts
    );
    if (!built.ok) {
      return NextResponse.json({ error: built.error, code: built.code }, { status: 400 });
    }

    await client.query('BEGIN');
    const { voucherId, voucherNumber } = await postContraVoucher(client, {
      businessId,
      branchId,
      entryDate,
      reference: body.reference_number ? String(body.reference_number).slice(0, 100) : null,
      narration: body.narration ? String(body.narration) : null,
      createdBy: userId,
      lines: built.lines,
      kind: built.kind,
    });
    await client.query('COMMIT');

    return NextResponse.json(
      { voucher_id: voucherId, voucher_number: voucherNumber, kind: built.kind },
      { status: 201 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating contra voucher:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
