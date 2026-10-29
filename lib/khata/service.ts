/**
 * Store khata accounts (docs/plan/STORE_KHATA.md): business rules, the customer's khata summary,
 * the link between a store shopper and a customer, khata requests and opening a khata.
 *
 * The customer and business always come from the server (store session or staff session),
 * never from a request body.
 */
import type { PoolClient } from 'pg';
import { getPool, query, queryOne } from '@/lib/db';
import { todayIst } from '@/lib/gst/time-limits';
import { storePhoneDigits } from '@/lib/store/store-phone';
import { isKhataRule, type KhataRule } from './rules';
import { isKhataOverdue, isValidSettlementDay, khataPayBy, khataStatementDateFor } from './cycle';

type Q = Pick<PoolClient, 'query'>;

export type KhataSettings = {
  overLimitRule: KhataRule;
  overdueRule: KhataRule;
  graceDays: number;
  reminderIntervalDays: number;
  allowPartPayment: boolean;
  statementsEnabled: boolean;
};

export const DEFAULT_KHATA_SETTINGS: KhataSettings = {
  overLimitRule: 'approval',
  overdueRule: 'approval',
  graceDays: 0,
  reminderIntervalDays: 3,
  allowPartPayment: true,
  statementsEnabled: true,
};

export class KhataError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = 'KhataError';
  }
}

function db(q?: Q): Q {
  return q ?? getPool();
}

export async function getKhataSettings(businessId: string, q?: Q): Promise<KhataSettings> {
  const r = await db(q).query<{
    khata_over_limit_rule: string | null;
    khata_overdue_rule: string | null;
    khata_grace_days: number | null;
    khata_reminder_interval_days: number | null;
    khata_allow_part_payment: boolean | null;
    khata_statements_enabled: boolean | null;
  }>(
    `SELECT khata_over_limit_rule, khata_overdue_rule, khata_grace_days, khata_reminder_interval_days,
            khata_allow_part_payment, khata_statements_enabled
       FROM business_settings WHERE business_id = $1`,
    [businessId],
  );
  const row = r.rows[0];
  if (!row) return { ...DEFAULT_KHATA_SETTINGS };
  return {
    overLimitRule: isKhataRule(row.khata_over_limit_rule) ? row.khata_over_limit_rule : DEFAULT_KHATA_SETTINGS.overLimitRule,
    overdueRule: isKhataRule(row.khata_overdue_rule) ? row.khata_overdue_rule : DEFAULT_KHATA_SETTINGS.overdueRule,
    graceDays: Number(row.khata_grace_days ?? 0) || 0,
    reminderIntervalDays: Number(row.khata_reminder_interval_days ?? 3) || 3,
    allowPartPayment: row.khata_allow_part_payment !== false,
    statementsEnabled: row.khata_statements_enabled !== false,
  };
}

export async function saveKhataSettings(businessId: string, input: Partial<KhataSettings>): Promise<KhataSettings> {
  const current = await getKhataSettings(businessId);
  const next: KhataSettings = {
    overLimitRule: isKhataRule(input.overLimitRule) ? input.overLimitRule : current.overLimitRule,
    overdueRule: isKhataRule(input.overdueRule) ? input.overdueRule : current.overdueRule,
    graceDays: clampInt(input.graceDays, 0, 60, current.graceDays),
    reminderIntervalDays: clampInt(input.reminderIntervalDays, 1, 30, current.reminderIntervalDays),
    allowPartPayment: typeof input.allowPartPayment === 'boolean' ? input.allowPartPayment : current.allowPartPayment,
    statementsEnabled: typeof input.statementsEnabled === 'boolean' ? input.statementsEnabled : current.statementsEnabled,
  };
  await query(
    `INSERT INTO business_settings
       (business_id, khata_over_limit_rule, khata_overdue_rule, khata_grace_days,
        khata_reminder_interval_days, khata_allow_part_payment, khata_statements_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (business_id) DO UPDATE SET
       khata_over_limit_rule = EXCLUDED.khata_over_limit_rule,
       khata_overdue_rule = EXCLUDED.khata_overdue_rule,
       khata_grace_days = EXCLUDED.khata_grace_days,
       khata_reminder_interval_days = EXCLUDED.khata_reminder_interval_days,
       khata_allow_part_payment = EXCLUDED.khata_allow_part_payment,
       khata_statements_enabled = EXCLUDED.khata_statements_enabled,
       updated_at = CURRENT_TIMESTAMP`,
    [
      businessId,
      next.overLimitRule,
      next.overdueRule,
      next.graceDays,
      next.reminderIntervalDays,
      next.allowPartPayment,
      next.statementsEnabled,
    ],
  );
  return next;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export type KhataCustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  khata_enabled: boolean;
  khata_settlement_day: number | null;
  khata_over_limit_rule: string | null;
  khata_overdue_rule: string | null;
  khata_requested_at: string | null;
  khata_opened_at: string | null;
  credit_limit: string | null;
  current_balance: string | null;
};

const CUSTOMER_COLS = `id, name, phone, khata_enabled, khata_settlement_day, khata_over_limit_rule,
  khata_overdue_rule, khata_requested_at, khata_opened_at, credit_limit::text, current_balance::text`;

export async function loadKhataCustomer(
  businessId: string,
  customerId: string,
  q?: Q,
  lock = false,
): Promise<KhataCustomerRow | null> {
  const r = await db(q).query<KhataCustomerRow>(
    `SELECT ${CUSTOMER_COLS} FROM customers
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [customerId, businessId],
  );
  return r.rows[0] ?? null;
}

/** Rule for this customer: the customer's override, else the business rule. */
export function effectiveKhataRules(
  customer: Pick<KhataCustomerRow, 'khata_over_limit_rule' | 'khata_overdue_rule'>,
  settings: KhataSettings,
): { overLimitRule: KhataRule; overdueRule: KhataRule } {
  return {
    overLimitRule: isKhataRule(customer.khata_over_limit_rule) ? customer.khata_over_limit_rule : settings.overLimitRule,
    overdueRule: isKhataRule(customer.khata_overdue_rule) ? customer.khata_overdue_rule : settings.overdueRule,
  };
}

/** Amount on the customer's final bills that are past due date plus grace. */
export async function khataOverdueAmount(
  businessId: string,
  customerId: string,
  graceDays: number,
  today: string,
  q?: Q,
): Promise<{ amount: number; oldestDue: string | null }> {
  const r = await db(q).query<{ amount: string | null; oldest: string | null }>(
    `SELECT COALESCE(SUM(balance_amount), 0)::text AS amount, MIN(due_date)::text AS oldest
       FROM invoices
      WHERE business_id = $1 AND customer_id = $2
        AND status = 'final' AND deleted_at IS NULL
        AND COALESCE(balance_amount, 0) > 0.005
        AND due_date IS NOT NULL
        AND due_date + ($3::int) < $4::date`,
    [businessId, customerId, graceDays, today],
  );
  return { amount: Number(r.rows[0]?.amount ?? 0) || 0, oldestDue: r.rows[0]?.oldest ?? null };
}

/** Khata store orders not yet billed: waiting for approval, or approved and still posting. */
export async function khataPendingOrdersTotal(businessId: string, customerId: string, q?: Q): Promise<number> {
  const r = await db(q).query<{ total: string | null }>(
    `SELECT COALESCE(SUM(grand_total), 0)::text AS total
       FROM store_orders
      WHERE business_id = $1 AND khata_customer_id = $2
        AND payment_provider = 'khata' AND invoice_id IS NULL
        AND status <> 'cancelled' AND COALESCE(khata_approval, '') <> 'rejected'`,
    [businessId, customerId],
  );
  return Number(r.rows[0]?.total ?? 0) || 0;
}

export type KhataSummary = {
  customerId: string;
  name: string;
  phone: string | null;
  enabled: boolean;
  requestedAt: string | null;
  settlementDay: number | null;
  creditLimit: number;
  balance: number;
  overdueAmount: number;
  oldestOverdueDue: string | null;
  pendingOrders: number;
  available: number | null;
  /** Next statement date from today; bills from today go on it. */
  nextStatementDate: string | null;
  /** Pay-by date of the bills already due (oldest open bill), else the next statement. */
  payBy: string | null;
  graceDays: number;
  rules: { overLimitRule: KhataRule; overdueRule: KhataRule };
  customRules: { overLimitRule: KhataRule | null; overdueRule: KhataRule | null };
};

export async function khataSummary(
  businessId: string,
  customerId: string,
  opts: { today?: string; q?: Q } = {},
): Promise<KhataSummary | null> {
  const q = opts.q;
  const today = opts.today ?? todayIst();
  const customer = await loadKhataCustomer(businessId, customerId, q);
  if (!customer) return null;
  const settings = await getKhataSettings(businessId, q);
  const overdue = await khataOverdueAmount(businessId, customerId, settings.graceDays, today, q);
  const pendingOrders = await khataPendingOrdersTotal(businessId, customerId, q);
  const balance = Number(customer.current_balance ?? 0) || 0;
  const creditLimit = Number(customer.credit_limit ?? 0) || 0;
  const day = customer.khata_settlement_day;
  const nextStatementDate = day != null && isValidSettlementDay(day) ? khataStatementDateFor(today, day) : null;
  const oldestOpen = await db(q).query<{ due: string | null }>(
    `SELECT MIN(due_date)::text AS due FROM invoices
      WHERE business_id = $1 AND customer_id = $2 AND status = 'final' AND deleted_at IS NULL
        AND COALESCE(balance_amount, 0) > 0.005 AND due_date IS NOT NULL`,
    [businessId, customerId],
  );
  const oldestDue = oldestOpen.rows[0]?.due ?? null;
  const payBy = oldestDue
    ? khataPayBy(oldestDue, settings.graceDays)
    : nextStatementDate
      ? khataPayBy(nextStatementDate, settings.graceDays)
      : null;
  return {
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    enabled: customer.khata_enabled,
    requestedAt: customer.khata_requested_at,
    settlementDay: day,
    creditLimit,
    balance,
    overdueAmount: overdue.amount,
    oldestOverdueDue: overdue.oldestDue,
    pendingOrders,
    available: creditLimit > 0 ? Math.max(0, round2(creditLimit - Math.max(0, balance) - pendingOrders)) : null,
    nextStatementDate,
    payBy,
    graceDays: settings.graceDays,
    rules: effectiveKhataRules(customer, settings),
    customRules: {
      overLimitRule: isKhataRule(customer.khata_over_limit_rule) ? customer.khata_over_limit_rule : null,
      overdueRule: isKhataRule(customer.khata_overdue_rule) ? customer.khata_overdue_rule : null,
    },
  };
}

/**
 * The customer whose khata a store shopper orders on. Uses the explicit link; without one, a
 * verified shopper is linked when exactly one customer with an open khata has the same number.
 */
export async function khataCustomerForShopper(
  businessId: string,
  storeCustomerId: string,
  q?: Q,
): Promise<KhataCustomerRow | null> {
  const shopper = await db(q).query<{ customer_id: string | null; phone: string }>(
    `SELECT customer_id, phone FROM store_customers WHERE id = $1 AND business_id = $2`,
    [storeCustomerId, businessId],
  );
  const s = shopper.rows[0];
  if (!s) return null;
  if (s.customer_id) {
    return loadKhataCustomer(businessId, s.customer_id, q);
  }
  const digits = storePhoneDigits(s.phone);
  if (digits.length !== 10) return null;
  const matches = await db(q).query<{ id: string }>(
    `SELECT id FROM customers
      WHERE business_id = $1 AND deleted_at IS NULL AND khata_enabled = true
        AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2
      LIMIT 2`,
    [businessId, digits],
  );
  if (matches.rows.length !== 1) return null;
  const customerId = matches.rows[0].id;
  await db(q).query(
    `UPDATE store_customers SET customer_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND business_id = $3 AND customer_id IS NULL`,
    [customerId, storeCustomerId, businessId],
  );
  return loadKhataCustomer(businessId, customerId, q);
}

/**
 * Shopper asks for a khata from the store. Links (or creates) the customer record, marks the
 * request and alerts the business. Asking twice does not alert twice within a day.
 */
export async function requestKhataFromStore(input: {
  businessId: string;
  storeCustomerId: string;
  branchId?: string | null;
}): Promise<{ customerId: string; status: 'requested' | 'already_open' | 'already_requested' }> {
  const client = await getPool().connect();
  let alert: { customerId: string; name: string; phone: string } | null = null;
  let result: { customerId: string; status: 'requested' | 'already_open' | 'already_requested' };
  try {
    await client.query('BEGIN');
    const shopper = await client.query<{ customer_id: string | null; phone: string; name: string | null }>(
      `SELECT customer_id, phone, name FROM store_customers WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [input.storeCustomerId, input.businessId],
    );
    const s = shopper.rows[0];
    if (!s) throw new KhataError('Sign in to ask for a khata', 401, 'SIGN_IN_REQUIRED');
    const digits = storePhoneDigits(s.phone);
    if (digits.length !== 10) throw new KhataError('A 10-digit mobile number is needed', 400, 'PHONE_REQUIRED');

    let customerId = s.customer_id;
    if (customerId) {
      const linked = await loadKhataCustomer(input.businessId, customerId, client);
      if (!linked) customerId = null;
    }
    if (!customerId) {
      const found = await client.query<{ id: string }>(
        `SELECT id FROM customers
          WHERE business_id = $1 AND deleted_at IS NULL
            AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2
          ORDER BY khata_enabled DESC, created_at ASC
          LIMIT 1`,
        [input.businessId, digits],
      );
      customerId = found.rows[0]?.id ?? null;
    }
    if (!customerId) {
      const branch = input.branchId
        ? input.branchId
        : (
            await client.query<{ id: string }>(
              `SELECT id FROM branches WHERE business_id = $1 AND COALESCE(is_active, true) = true
                ORDER BY COALESCE(is_default, false) DESC, COALESCE(is_primary, false) DESC, created_at ASC LIMIT 1`,
              [input.businessId],
            )
          ).rows[0]?.id ?? null;
      const name = String(s.name || '').trim() || `Store customer ${digits.slice(-4)}`;
      const created = await client.query<{ id: string }>(
        `INSERT INTO customers (business_id, branch_id, name, phone, notes)
         VALUES ($1, $2, $3, $4, 'Asked for a khata from the online store')
         RETURNING id`,
        [input.businessId, branch, name, digits],
      );
      customerId = created.rows[0].id;
    }
    await client.query(
      `UPDATE store_customers SET customer_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3`,
      [customerId, input.storeCustomerId, input.businessId],
    );
    const c = await loadKhataCustomer(input.businessId, customerId, client, true);
    if (!c) throw new KhataError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    if (c.khata_enabled) {
      result = { customerId, status: 'already_open' };
    } else {
      const recent = c.khata_requested_at && Date.now() - new Date(c.khata_requested_at).getTime() < 24 * 3600_000;
      await client.query(
        `UPDATE customers SET khata_requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2`,
        [customerId, input.businessId],
      );
      result = { customerId, status: recent ? 'already_requested' : 'requested' };
      if (!recent) alert = { customerId, name: c.name, phone: digits };
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  if (alert) {
    const { notifyMerchantKhataRequest } = await import('./notify');
    void notifyMerchantKhataRequest({ businessId: input.businessId, ...alert });
  }
  return result;
}

export type OpenKhataInput = {
  settlementDay: number;
  creditLimit?: number | null;
  overLimitRule?: KhataRule | null;
  overdueRule?: KhataRule | null;
};

/** Staff opens or updates a customer's khata. Links store shoppers with the same number. */
export async function openKhata(businessId: string, customerId: string, input: OpenKhataInput): Promise<void> {
  if (!isValidSettlementDay(input.settlementDay)) {
    throw new KhataError('Choose a settlement day from 1 to 28, or the last day of the month', 400, 'INVALID_DAY');
  }
  if (input.creditLimit != null && (!Number.isFinite(input.creditLimit) || input.creditLimit < 0)) {
    throw new KhataError('Credit limit must be zero (no limit) or more', 400, 'INVALID_LIMIT');
  }
  const client = await getPool().connect();
  let notifyOpened: { phone: string; name: string; firstTime: boolean } | null = null;
  try {
    await client.query('BEGIN');
    const c = await loadKhataCustomer(businessId, customerId, client, true);
    if (!c) throw new KhataError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    await client.query(
      `UPDATE customers SET
         khata_enabled = true,
         khata_settlement_day = $3,
         khata_over_limit_rule = $4,
         khata_overdue_rule = $5,
         credit_limit = COALESCE($6, credit_limit),
         khata_opened_at = COALESCE(khata_opened_at, CURRENT_TIMESTAMP),
         khata_requested_at = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2`,
      [
        customerId,
        businessId,
        input.settlementDay,
        isKhataRule(input.overLimitRule) ? input.overLimitRule : null,
        isKhataRule(input.overdueRule) ? input.overdueRule : null,
        input.creditLimit == null ? null : round2(input.creditLimit),
      ],
    );
    const digits = storePhoneDigits(c.phone || '');
    if (digits.length === 10) {
      // Only shoppers not linked elsewhere; their sign-in was verified by OTP on this number.
      await client.query(
        `UPDATE store_customers SET customer_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE business_id = $2 AND customer_id IS NULL
            AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $3`,
        [customerId, businessId, digits],
      );
      notifyOpened = { phone: digits, name: c.name, firstTime: !c.khata_enabled };
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  if (notifyOpened?.firstTime) {
    const { notifyCustomerKhataOpened } = await import('./notify');
    void notifyCustomerKhataOpened({ businessId, customerId, phone: notifyOpened.phone, name: notifyOpened.name });
  }
}

/** Stops new khata orders. What is owed stays on the ledger. */
export async function closeKhata(businessId: string, customerId: string): Promise<void> {
  const r = await query(
    `UPDATE customers SET khata_enabled = false, khata_requested_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [customerId, businessId],
  );
  if (!r.rowCount) throw new KhataError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
}

/** Staff dismisses a store khata request without opening one. */
export async function dismissKhataRequest(businessId: string, customerId: string): Promise<void> {
  await query(
    `UPDATE customers SET khata_requested_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2`,
    [customerId, businessId],
  );
}

/** Due date for a new bill of a khata customer, or null when the customer has no khata. */
export async function khataDueDateForCustomer(
  businessId: string,
  customerId: string | null | undefined,
  billDate: string,
  q?: Q,
): Promise<string | null> {
  if (!customerId) return null;
  const r = await db(q).query<{ khata_enabled: boolean; khata_settlement_day: number | null }>(
    `SELECT khata_enabled, khata_settlement_day FROM customers
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [customerId, businessId],
  );
  const row = r.rows[0];
  if (!row?.khata_enabled || row.khata_settlement_day == null || !isValidSettlementDay(row.khata_settlement_day)) {
    return null;
  }
  return khataStatementDateFor(billDate.slice(0, 10), row.khata_settlement_day);
}

export { isKhataOverdue };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function businessName(businessId: string, q?: Q): Promise<string> {
  const r = await queryOne<{ name: string }>(`SELECT name FROM businesses WHERE id = $1`, [businessId]);
  void q;
  return r?.name ?? 'the shop';
}
