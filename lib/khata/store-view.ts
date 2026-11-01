/**
 * What the shopper sees of their khata in the online store ("My khata", docs/plan/STORE_KHATA.md
 * section 6), and the statement view behind a statement link. Read-only figures; paying goes
 * through lib/khata/online-pay.ts.
 */
import { queryRows } from '@/lib/db';
import { todayIst } from '@/lib/gst/time-limits';
import { ensureInvoicePublicToken } from '@/lib/customer-surface/public-token';
import { publicInvoiceUrl } from '@/lib/customer-surface/urls';
import { getBusinessUpiVpa, upiAppLinks } from '@/lib/payments/upi-pay-link';
import { getKhataSettings, khataCustomerForShopper, khataSummary } from './service';
import { isKhataOverdue, khataPayBy, khataSettlementDayLabel, khataShortDate } from './cycle';
import { khataGateway } from './online-pay';
import { listKhataStatements, type KhataStatementRow } from './statements';

export type StoreKhataStatus =
  | { status: 'none' }
  | { status: 'requested' }
  | {
      status: 'open';
      balance: number;
      overdue_amount: number;
      credit_limit: number;
      available: number | null;
      pending_orders: number;
      pay_by: string | null;
      pay_by_label: string | null;
      next_statement_date: string | null;
      settlement_day_label: string;
    };

/** Khata state for the signed-in shopper: drives checkout and the account page. */
export async function storeKhataStatus(businessId: string, storeCustomerId: string): Promise<StoreKhataStatus> {
  const c = await khataCustomerForShopper(businessId, storeCustomerId);
  if (!c) return { status: 'none' };
  if (!c.khata_enabled || c.khata_settlement_day == null) {
    return c.khata_requested_at ? { status: 'requested' } : { status: 'none' };
  }
  const s = await khataSummary(businessId, c.id);
  if (!s) return { status: 'none' };
  return {
    status: 'open',
    balance: s.balance,
    overdue_amount: s.overdueAmount,
    credit_limit: s.creditLimit,
    available: s.available,
    pending_orders: s.pendingOrders,
    pay_by: s.payBy,
    pay_by_label: s.payBy ? khataShortDate(s.payBy) : null,
    next_statement_date: s.nextStatementDate,
    settlement_day_label: khataSettlementDayLabel(c.khata_settlement_day),
  };
}

type Bill = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  grand_total: number;
  balance_amount: number;
};

async function billsWithLinks(rows: Bill[], graceDays: number) {
  const today = todayIst();
  const out = [];
  for (const b of rows.slice(0, 40)) {
    const token = await ensureInvoicePublicToken(b.id).catch(() => null);
    out.push({
      invoice_number: b.invoice_number,
      invoice_date: b.invoice_date,
      due_date: b.due_date,
      pay_by: b.due_date ? khataPayBy(b.due_date, graceDays) : null,
      amount: b.grand_total,
      balance: b.balance_amount,
      overdue: b.due_date ? isKhataOverdue(b.due_date, today, graceDays) : false,
      link: token ? publicInvoiceUrl(token) : null,
    });
  }
  return out;
}

async function payOptions(businessId: string, storeName: string, amount: number, reference: string) {
  const settings = await getKhataSettings(businessId);
  const gateway = await khataGateway(businessId);
  let upi: { vpa: string; amount: number; links: ReturnType<typeof upiAppLinks> } | null = null;
  if (!gateway && amount >= 1) {
    const vpa = await getBusinessUpiVpa(businessId);
    if (vpa) {
      upi = {
        vpa,
        amount,
        links: upiAppLinks({ vpa, payeeName: storeName, amount, note: `Khata ${reference}`, reference }),
      };
    }
  }
  return { online: Boolean(gateway), allow_part_payment: settings.allowPartPayment, upi };
}

/** "My khata" for a signed-in shopper whose khata is open; null when it is not. */
export async function storeKhataDetail(businessId: string, storeName: string, storeCustomerId: string) {
  const c = await khataCustomerForShopper(businessId, storeCustomerId);
  if (!c || !c.khata_enabled) return null;
  const status = await storeKhataStatus(businessId, storeCustomerId);
  if (status.status !== 'open') return null;
  const settings = await getKhataSettings(businessId);
  const bills = await queryRows<Bill>(
    `SELECT id, invoice_number, invoice_date::text, due_date::text,
            grand_total::float8 AS grand_total, balance_amount::float8 AS balance_amount
       FROM invoices
      WHERE business_id = $1 AND customer_id = $2 AND status = 'final' AND deleted_at IS NULL
        AND COALESCE(balance_amount, 0) > 0.005
      ORDER BY due_date ASC NULLS LAST, invoice_date ASC, created_at ASC`,
    [businessId, c.id],
  );
  const payments = await queryRows<{ payment_date: string; amount: number; payment_mode: string | null }>(
    `SELECT payment_date::text, SUM(amount)::float8 AS amount, MIN(payment_mode) AS payment_mode
       FROM payments
      WHERE business_id = $1 AND customer_id = $2 AND type = 'receivable'
        AND deleted_at IS NULL AND COALESCE(status, 'active') = 'active'
      GROUP BY payment_date, COALESCE(notes, id::text)
      ORDER BY payment_date DESC
      LIMIT 10`,
    [businessId, c.id],
  );
  const statements = await listKhataStatements(businessId, c.id, 6);
  const owed = Math.round(bills.reduce((s, b) => s + b.balance_amount, 0) * 100) / 100;
  return {
    name: c.name,
    khata: status,
    bills: await billsWithLinks(bills, settings.graceDays),
    payments,
    statements: statements.map(statementCard),
    owed,
    pay: await payOptions(businessId, storeName, owed, c.id.slice(0, 8).toUpperCase()),
  };
}

function statementCard(s: KhataStatementRow) {
  return {
    statement_date: s.statement_date,
    due_date: s.due_date,
    closing_due: s.closing_due,
    token: s.public_token,
  };
}

/** The statement behind a statement link, with what is still open on the khata today. */
export async function storeKhataStatementView(businessId: string, storeName: string, statement: KhataStatementRow) {
  const settings = await getKhataSettings(businessId);
  const customer = await queryRows<{ name: string; current_balance: number }>(
    `SELECT name, current_balance::float8 AS current_balance FROM customers WHERE id = $1 AND business_id = $2`,
    [statement.customer_id, businessId],
  );
  const bills = await queryRows<Bill>(
    `SELECT id, invoice_number, invoice_date::text, due_date::text,
            grand_total::float8 AS grand_total, balance_amount::float8 AS balance_amount
       FROM invoices
      WHERE business_id = $1 AND customer_id = $2 AND status = 'final' AND deleted_at IS NULL
        AND (COALESCE(balance_amount, 0) > 0.005 OR invoice_date BETWEEN $3::date AND $4::date)
      ORDER BY invoice_date ASC, created_at ASC`,
    [businessId, statement.customer_id, statement.period_start, statement.period_end],
  );
  const owed = Math.round(bills.reduce((s, b) => s + Math.max(0, b.balance_amount), 0) * 100) / 100;
  const firstName = (customer[0]?.name ?? '').trim().split(/\s+/)[0] || 'there';
  return {
    name: firstName,
    statement: {
      period_start: statement.period_start,
      period_end: statement.period_end,
      statement_date: statement.statement_date,
      due_date: statement.due_date,
      due_label: khataShortDate(statement.due_date),
      opening_due: statement.opening_due,
      charges: statement.charges,
      payments: statement.payments,
      closing_due: statement.closing_due,
    },
    owed_now: owed,
    bills: await billsWithLinks(bills, settings.graceDays),
    pay: await payOptions(businessId, storeName, owed, statement.public_token.slice(0, 8).toUpperCase()),
  };
}
