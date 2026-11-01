/**
 * Khata statements (docs/plan/STORE_KHATA.md, section 5). On a customer's settlement day a
 * statement is stored and sent on WhatsApp; after the pay-by date, overdue reminders follow every
 * few days until the khata is paid. A stored statement keeps its figures, so the link in a message
 * always shows what the message said.
 */
import { randomBytes } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { todayIst } from '@/lib/gst/time-limits';
import { getKhataSettings, khataOverdueAmount, type KhataSettings } from './service';
import {
  isKhataStatementDay,
  khataPayBy,
  khataStatementDateFor,
  khataStatementPeriod,
  isValidSettlementDay,
} from './cycle';

export type KhataStatementRow = {
  id: string;
  business_id: string;
  customer_id: string;
  period_start: string;
  period_end: string;
  statement_date: string;
  due_date: string;
  opening_due: number;
  charges: number;
  payments: number;
  closing_due: number;
  public_token: string;
  sent_at: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
};

const STATEMENT_COLS = `id, business_id, customer_id, period_start::text, period_end::text,
  statement_date::text, due_date::text, opening_due::float8 AS opening_due, charges::float8 AS charges,
  payments::float8 AS payments, closing_due::float8 AS closing_due, public_token, sent_at, last_reminder_at,
  reminder_count`;

type Q = Pick<PoolClient, 'query'>;

/**
 * Stores the statement for `statementDate` (once). Figures: bills dated in the period, receipts
 * dated in the period, and the customer balance now as the closing due.
 * On a settlement day the period is that cycle and payment is due that day (plus grace).
 * A statement asked for on another day (`manual`) covers the current cycle up to today, is due on
 * the next settlement day, and refreshes the figures if one was already made today.
 */
export async function createKhataStatement(
  q: Q,
  input: {
    businessId: string;
    customerId: string;
    statementDate: string;
    settlementDay: number;
    graceDays: number;
    manual?: boolean;
  },
): Promise<{ statement: KhataStatementRow; created: boolean }> {
  const onSettlementDay = isKhataStatementDay(input.statementDate, input.settlementDay);
  let { start, end } = khataStatementPeriod(input.statementDate, input.settlementDay);
  let dueOn = input.statementDate;
  if (!onSettlementDay) {
    const next = khataStatementDateFor(input.statementDate, input.settlementDay);
    start = khataStatementPeriod(next, input.settlementDay).start;
    end = input.statementDate;
    dueOn = next;
  }
  const sums = await q.query<{ charges: string; payments: string; balance: string }>(
    `SELECT
       (SELECT COALESCE(SUM(grand_total), 0) FROM invoices
         WHERE business_id = $1 AND customer_id = $2 AND status = 'final' AND deleted_at IS NULL
           AND invoice_date BETWEEN $3::date AND $4::date)::text AS charges,
       (SELECT COALESCE(SUM(amount), 0) FROM payments
         WHERE business_id = $1 AND customer_id = $2 AND type = 'receivable'
           AND deleted_at IS NULL AND COALESCE(status, 'active') = 'active'
           AND payment_date BETWEEN $3::date AND $4::date)::text AS payments,
       (SELECT COALESCE(current_balance, 0) FROM customers WHERE id = $2 AND business_id = $1)::text AS balance`,
    [input.businessId, input.customerId, start, end],
  );
  const charges = round2(Number(sums.rows[0]?.charges ?? 0));
  const payments = round2(Number(sums.rows[0]?.payments ?? 0));
  const closing = round2(Math.max(0, Number(sums.rows[0]?.balance ?? 0)));
  const opening = round2(closing - charges + payments);
  const inserted = await q.query<KhataStatementRow>(
    `INSERT INTO khata_statements
       (business_id, customer_id, period_start, period_end, statement_date, due_date,
        opening_due, charges, payments, closing_due, public_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (business_id, customer_id, statement_date) ${
       input.manual
         ? `DO UPDATE SET period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
              due_date = EXCLUDED.due_date, opening_due = EXCLUDED.opening_due, charges = EXCLUDED.charges,
              payments = EXCLUDED.payments, closing_due = EXCLUDED.closing_due`
         : 'DO NOTHING'
     }
     RETURNING ${STATEMENT_COLS}, (xmax = 0) AS inserted`,
    [
      input.businessId,
      input.customerId,
      start,
      end,
      input.statementDate,
      khataPayBy(dueOn, input.graceDays),
      opening,
      charges,
      payments,
      closing,
      randomBytes(18).toString('base64url'),
    ],
  );
  if (inserted.rows[0]) {
    const { inserted: isNew, ...statement } = inserted.rows[0] as KhataStatementRow & { inserted: boolean };
    return { statement, created: Boolean(isNew) };
  }
  const existing = await q.query<KhataStatementRow>(
    `SELECT ${STATEMENT_COLS} FROM khata_statements
      WHERE business_id = $1 AND customer_id = $2 AND statement_date = $3`,
    [input.businessId, input.customerId, input.statementDate],
  );
  return { statement: existing.rows[0], created: false };
}

export type KhataRunResult = { statements: number; reminders: number; skipped: number; errors: number };

/**
 * Daily job: statements for customers whose settlement day is `today`, then overdue reminders.
 * Safe to run more than once a day: a statement is stored once and sent once; a reminder waits
 * for the business's reminder interval.
 */
export async function runKhataStatements(opts: { today?: string; businessId?: string } = {}): Promise<KhataRunResult> {
  const today = opts.today ?? todayIst();
  const result: KhataRunResult = { statements: 0, reminders: 0, skipped: 0, errors: 0 };
  const customers = await queryRows<{
    business_id: string;
    id: string;
    name: string;
    phone: string | null;
    khata_settlement_day: number;
    balance: string;
  }>(
    `SELECT c.business_id, c.id, c.name, c.phone, c.khata_settlement_day, c.current_balance::text AS balance
       FROM customers c
       LEFT JOIN business_settings bs ON bs.business_id = c.business_id
      WHERE c.khata_enabled = true AND c.deleted_at IS NULL AND c.khata_settlement_day IS NOT NULL
        AND COALESCE(bs.khata_statements_enabled, true) = true
        AND ($1::uuid IS NULL OR c.business_id = $1::uuid)`,
    [opts.businessId ?? null],
  );
  const settingsCache = new Map<string, KhataSettings>();
  const settingsFor = async (businessId: string) => {
    let s = settingsCache.get(businessId);
    if (!s) {
      s = await getKhataSettings(businessId);
      settingsCache.set(businessId, s);
    }
    return s;
  };

  for (const c of customers) {
    try {
      if (!isValidSettlementDay(c.khata_settlement_day)) continue;
      const settings = await settingsFor(c.business_id);
      if (isKhataStatementDay(today, c.khata_settlement_day) && Number(c.balance) > 0.005) {
        const { statement } = await createKhataStatement(getPool(), {
          businessId: c.business_id,
          customerId: c.id,
          statementDate: today,
          settlementDay: c.khata_settlement_day,
          graceDays: settings.graceDays,
        });
        if (!statement.sent_at && c.phone) {
          // Claim before sending so two runs never send the same statement twice.
          const claimed = await getPool().query(
            `UPDATE khata_statements SET sent_at = CURRENT_TIMESTAMP WHERE id = $1 AND sent_at IS NULL`,
            [statement.id],
          );
          if (claimed.rowCount === 1) {
            const { sendKhataStatementMessage } = await import('./notify');
            const sent = await sendKhataStatementMessage({
              businessId: c.business_id,
              phone: c.phone,
              customerName: c.name,
              amountDue: statement.closing_due,
              payBy: statement.due_date,
              statementToken: statement.public_token,
              kind: 'statement',
            });
            if (sent.via) {
              result.statements += 1;
            } else {
              // Not delivered (WhatsApp not connected): keep the statement, but do not mark it sent.
              await getPool().query(`UPDATE khata_statements SET sent_at = NULL WHERE id = $1`, [statement.id]);
              result.skipped += 1;
            }
            continue;
          }
        }
        result.skipped += 1;
        continue;
      }
      if (await sendOverdueReminderIfDue(c, settings, today)) result.reminders += 1;
    } catch (err) {
      result.errors += 1;
      console.error('[khata statements]', c.business_id, c.id, err);
    }
  }
  return result;
}

const MAX_OVERDUE_REMINDERS = 10;

async function sendOverdueReminderIfDue(
  c: { business_id: string; id: string; name: string; phone: string | null; balance: string },
  settings: KhataSettings,
  today: string,
): Promise<boolean> {
  if (!c.phone || Number(c.balance) <= 0.005) return false;
  const overdue = await khataOverdueAmount(c.business_id, c.id, settings.graceDays, today);
  if (overdue.amount <= 0.005) return false;
  const latest = await queryOne<KhataStatementRow>(
    `SELECT ${STATEMENT_COLS} FROM khata_statements
      WHERE business_id = $1 AND customer_id = $2
      ORDER BY statement_date DESC LIMIT 1`,
    [c.business_id, c.id],
  );
  if (!latest || latest.due_date >= today || latest.reminder_count >= MAX_OVERDUE_REMINDERS) return false;
  const claimed = await getPool().query(
    `UPDATE khata_statements
        SET last_reminder_at = CURRENT_TIMESTAMP, reminder_count = reminder_count + 1
      WHERE id = $1
        AND (last_reminder_at IS NULL OR last_reminder_at < CURRENT_TIMESTAMP - make_interval(days => $2::int) + INTERVAL '1 hour')`,
    [latest.id, settings.reminderIntervalDays],
  );
  if (claimed.rowCount !== 1) return false;
  const { sendKhataStatementMessage } = await import('./notify');
  const sent = await sendKhataStatementMessage({
    businessId: c.business_id,
    phone: c.phone,
    customerName: c.name,
    amountDue: round2(Math.min(overdue.amount, Number(c.balance) || 0)),
    payBy: latest.due_date,
    statementToken: latest.public_token,
    kind: 'overdue',
  });
  if (!sent.via) {
    // Not delivered: undo the claim so the next run tries again.
    await getPool().query(
      `UPDATE khata_statements SET last_reminder_at = $2, reminder_count = GREATEST(reminder_count - 1, 0) WHERE id = $1`,
      [latest.id, latest.last_reminder_at],
    );
    return false;
  }
  return true;
}

/**
 * Staff sends a statement now, whatever the day. It is saved even when WhatsApp cannot deliver it;
 * `sent` says whether WhatsApp took the message.
 */
export async function sendKhataStatementNow(
  businessId: string,
  customerId: string,
): Promise<{ statement: KhataStatementRow; sent: boolean }> {
  const c = await queryOne<{ name: string; phone: string | null; khata_settlement_day: number | null; khata_enabled: boolean }>(
    `SELECT name, phone, khata_settlement_day, khata_enabled FROM customers
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [customerId, businessId],
  );
  const { KhataError } = await import('./service');
  if (!c) throw new KhataError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  if (!c.khata_enabled || c.khata_settlement_day == null) {
    throw new KhataError('Open the khata first', 409, 'KHATA_NOT_OPEN');
  }
  if (!c.phone) throw new KhataError('Add the customer\'s phone number to send a statement', 409, 'PHONE_REQUIRED');
  const settings = await getKhataSettings(businessId);
  const today = todayIst();
  const { statement } = await createKhataStatement(getPool(), {
    businessId,
    customerId,
    statementDate: today,
    settlementDay: c.khata_settlement_day,
    graceDays: settings.graceDays,
    manual: true,
  });
  const { sendKhataStatementMessage } = await import('./notify');
  const result = await sendKhataStatementMessage({
    businessId,
    phone: c.phone,
    customerName: c.name,
    amountDue: statement.closing_due,
    payBy: statement.due_date,
    statementToken: statement.public_token,
    kind: 'statement',
  });
  const sent = Boolean(result.via);
  if (sent) {
    await getPool().query(`UPDATE khata_statements SET sent_at = CURRENT_TIMESTAMP WHERE id = $1`, [statement.id]);
  }
  return { statement: { ...statement, sent_at: sent ? new Date().toISOString() : statement.sent_at }, sent };
}

export async function listKhataStatements(businessId: string, customerId: string, limit = 12): Promise<KhataStatementRow[]> {
  return queryRows<KhataStatementRow>(
    `SELECT ${STATEMENT_COLS} FROM khata_statements
      WHERE business_id = $1 AND customer_id = $2
      ORDER BY statement_date DESC LIMIT $3`,
    [businessId, customerId, limit],
  );
}

export async function findKhataStatementByToken(token: string): Promise<KhataStatementRow | null> {
  if (!/^[A-Za-z0-9_-]{16,48}$/.test(token)) return null;
  return queryOne<KhataStatementRow>(`SELECT ${STATEMENT_COLS} FROM khata_statements WHERE public_token = $1`, [token]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
