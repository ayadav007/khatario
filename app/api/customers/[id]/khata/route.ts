import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryRows } from '@/lib/db';
import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import {
  KhataError,
  closeKhata,
  dismissKhataRequest,
  getKhataSettings,
  khataSummary,
  openKhata,
} from '@/lib/khata/service';
import { isKhataRule } from '@/lib/khata/rules';
import { isKhataOverdue } from '@/lib/khata/cycle';
import { isKhataPaymentMode, settleKhataPayment } from '@/lib/khata/settle';
import { listKhataStatements, sendKhataStatementNow } from '@/lib/khata/statements';
import { todayIst } from '@/lib/gst/time-limits';
import { SettlementAccountError } from '@/lib/accounting/settlement-accounts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/customers/[id]/khata — the customer's store khata: summary, open bills, statements,
 * khata store orders and linked store logins. Business and user come from the session.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await requireTenantPermission(request, request.nextUrl.searchParams.get('business_id'), 'customers', 'read');
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;
  const summary = await khataSummary(businessId, params.id);
  if (!summary) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  const settings = await getKhataSettings(businessId);
  const today = todayIst();

  const bills = await queryRows<{
    id: string;
    invoice_number: string;
    invoice_date: string;
    due_date: string | null;
    grand_total: number;
    balance_amount: number;
  }>(
    `SELECT id, invoice_number, invoice_date::text, due_date::text,
            grand_total::float8 AS grand_total, balance_amount::float8 AS balance_amount
       FROM invoices
      WHERE business_id = $1 AND customer_id = $2 AND status = 'final' AND deleted_at IS NULL
        AND COALESCE(balance_amount, 0) > 0.005
      ORDER BY due_date ASC NULLS LAST, invoice_date ASC, created_at ASC
      LIMIT 100`,
    [businessId, params.id],
  );
  const orders = await queryRows<{
    id: string;
    order_number: string;
    created_at: string;
    grand_total: number;
    status: string;
    khata_approval: string | null;
    khata_approval_reason: string | null;
    khata_due_date: string | null;
    invoice_id: string | null;
  }>(
    `SELECT id, order_number, created_at, grand_total::float8 AS grand_total, status, khata_approval,
            khata_approval_reason, khata_due_date::text, invoice_id
       FROM store_orders
      WHERE business_id = $1 AND khata_customer_id = $2 AND payment_provider = 'khata'
      ORDER BY created_at DESC LIMIT 20`,
    [businessId, params.id],
  );
  const logins = await queryRows<{ id: string; phone: string; name: string | null }>(
    `SELECT id, phone, name FROM store_customers WHERE business_id = $1 AND customer_id = $2 ORDER BY created_at`,
    [businessId, params.id],
  );
  const statements = await listKhataStatements(businessId, params.id, 6);

  return NextResponse.json({
    summary,
    settings,
    bills: bills.map((b) => ({
      ...b,
      overdue: b.due_date ? isKhataOverdue(b.due_date, today, settings.graceDays) : false,
    })),
    orders,
    store_logins: logins,
    statements,
  });
}

/**
 * POST /api/customers/[id]/khata
 * { action: 'open', settlement_day, credit_limit?, over_limit_rule?, overdue_rule? }
 * { action: 'close' } | { action: 'dismiss_request' } | { action: 'send_statement' }
 * { action: 'receive', amount, payment_mode, payment_date?, notes? } — settles open bills oldest first.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : '';
  const receiving = action === 'receive';
  const tenant = await requireTenantPermission(
    request,
    body.business_id,
    receiving ? 'payments' : 'customers',
    receiving ? 'create' : 'update',
  );
  if (!tenant.ok) return tenant.response;
  const { businessId, userId } = tenant;

  try {
    if (action === 'open') {
      const day = Number(body.settlement_day);
      const limitRaw = body.credit_limit;
      const creditLimit =
        limitRaw === undefined || limitRaw === null || limitRaw === '' ? null : Number(limitRaw);
      await openKhata(businessId, params.id, {
        settlementDay: day,
        creditLimit,
        overLimitRule: isKhataRule(body.over_limit_rule) ? body.over_limit_rule : null,
        overdueRule: isKhataRule(body.overdue_rule) ? body.overdue_rule : null,
      });
    } else if (action === 'close') {
      await closeKhata(businessId, params.id);
    } else if (action === 'dismiss_request') {
      await dismissKhataRequest(businessId, params.id);
    } else if (action === 'send_statement') {
      const { statement, sent } = await sendKhataStatementNow(businessId, params.id);
      const summary = await khataSummary(businessId, params.id);
      return NextResponse.json({ success: true, sent, statement_token: statement.public_token, summary });
    } else if (receiving) {
      if (!isKhataPaymentMode(body.payment_mode)) {
        return NextResponse.json({ error: 'Choose how the money was paid' }, { status: 400 });
      }
      const amount = Number(body.amount);
      const dateRaw = typeof body.payment_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.payment_date)
        ? body.payment_date
        : todayIst();
      if (dateRaw > todayIst()) {
        return NextResponse.json({ error: 'The payment date cannot be in the future' }, { status: 400 });
      }
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const result = await settleKhataPayment(client, {
          businessId,
          customerId: params.id,
          amount,
          paymentMode: body.payment_mode,
          createdBy: userId,
          reference: `KR-${Date.now().toString(36).toUpperCase()}`,
          paymentDate: new Date(`${dateRaw}T12:00:00+05:30`),
        });
        await client.query('COMMIT');
        const summary = await khataSummary(businessId, params.id);
        return NextResponse.json({ success: true, settlement: result, summary });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    const summary = await khataSummary(businessId, params.id);
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    if (error instanceof KhataError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof SettlementAccountError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof Error && /period/i.test(error.message) && /lock/i.test(error.message)) {
      return NextResponse.json({ error: error.message, code: 'PERIOD_LOCKED' }, { status: 409 });
    }
    console.error('[customer khata]', error);
    return NextResponse.json({ error: 'Could not update the khata' }, { status: 500 });
  }
}
