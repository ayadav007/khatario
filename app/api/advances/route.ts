import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryRows } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import { AdvanceError, createAdvance } from '@/lib/accounting/advance-service';
import { listCashBankAccounts } from '@/lib/accounting/contra';

export const dynamic = 'force-dynamic';

/** GET /api/advances?type=received|paid&status=open */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const guard = await guardLedgerRoute(request, {
      claimedBusinessId: searchParams.get('business_id'),
      action: 'read',
    });
    if (!guard.ok) return guard.response;
    const { businessId } = guard;

    const params: unknown[] = [businessId];
    let where = 'a.business_id = $1';
    const type = searchParams.get('type');
    if (type === 'received' || type === 'paid') {
      params.push(type);
      where += ` AND a.type = $${params.length}`;
    }
    const status = searchParams.get('status');
    if (status === 'open') where += ` AND a.status IN ('open', 'partially_adjusted')`;

    const advances = await queryRows(
      `SELECT a.id, a.type, a.voucher_number, a.payment_date::text, a.amount, a.taxable_value,
              a.cgst, a.sgst, a.igst, a.cess, a.tax_rate, a.supply_type, a.place_of_supply_state_code,
              a.adjusted_amount, a.refunded_amount, a.status, a.reference_number, a.notes,
              a.customer_id, a.supplier_id,
              COALESCE(c.name, s.name) AS party_name,
              (a.amount - a.adjusted_amount - a.refunded_amount) AS remaining
         FROM advance_payments a
         LEFT JOIN customers c ON c.id = a.customer_id
         LEFT JOIN suppliers s ON s.id = a.supplier_id
        WHERE ${where}
        ORDER BY a.payment_date DESC, a.voucher_number DESC NULLS LAST
        LIMIT 500`,
      params
    );

    const client = await getPool().connect();
    try {
      const accounts = await listCashBankAccounts(client, businessId);
      return NextResponse.json({ advances, accounts });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error listing advances:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/advances — record an advance received from a customer (Rule 50 receipt voucher)
 * or paid to a supplier.
 * Body: { type, customer_id | supplier_id, amount, payment_date, supply_type, tax_rate, cess_rate?,
 *         place_of_supply_state_code?, payment_account_id, reference_number?, notes?, branch_id? }
 */
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const type = body?.type;
  if (type !== 'received' && type !== 'paid') {
    return NextResponse.json({ error: "type must be 'received' or 'paid'" }, { status: 400 });
  }
  const date = typeof body.payment_date === 'string' ? body.payment_date.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'payment_date (YYYY-MM-DD) is required' }, { status: 400 });
  }
  const partyId = type === 'received' ? body.customer_id : body.supplier_id;
  if (!partyId) {
    return NextResponse.json({ error: type === 'received' ? 'customer_id is required' : 'supplier_id is required' }, { status: 400 });
  }
  const supplyType = body.supply_type === 'services' ? 'services' : 'goods';

  const guard = await guardLedgerRoute(request, {
    claimedBusinessId: body.business_id,
    branchId: body.branch_id,
    action: 'create',
    dates: [date],
    actionLabel: 'record an advance',
    checkGstFiled: type === 'received' && supplyType === 'services',
  });
  if (!guard.ok) return guard.response;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const created = await createAdvance(client, {
      businessId: guard.businessId,
      branchId: guard.branchId,
      userId: guard.userId,
      type,
      partyId: String(partyId),
      amount: Number(body.amount),
      date,
      supplyType,
      taxRate: Number(body.tax_rate) || 0,
      cessRate: Number(body.cess_rate) || 0,
      placeOfSupply: body.place_of_supply_state_code || null,
      paymentAccountId: String(body.payment_account_id || ''),
      reference: body.reference_number || null,
      notes: body.notes || null,
    });
    await client.query('COMMIT');
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof AdvanceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Error creating advance:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
