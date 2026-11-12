/**
 * What payment reminders are worth: money chased by WhatsApp reminders and how much of it came in.
 *
 * An invoice counts in a period when its FIRST sent reminder falls in that period.
 * - chased: what the invoice owed when that first reminder went out (whatsapp_messages.amount_due;
 *   reminders sent before migration 474 fall back to today's balance plus payments since).
 * - recovered: active receipts posted against the invoice after the first reminder, capped at chased.
 * - via link: the part paid online from the bill or bills link the reminder carries.
 * A combined reminder (one message for several bills) is logged once per bill, so each bill counts.
 * - pending: what the invoice still owes today.
 * A payment after a reminder is not proof the reminder caused it; the page says "after a reminder".
 */
import { queryOne, queryRows } from '@/lib/db';

export type RecoverySource = 'manual' | 'auto_payment_due' | 'auto_overdue';

export interface RecoveryTotals {
  invoices_reminded: number;
  reminders_sent: number;
  chased: number;
  recovered: number;
  recovered_via_link: number;
  pending: number;
  invoices_fully_paid: number;
  avg_days_to_pay: number | null;
}

export interface RecoveryBySource {
  source: RecoverySource;
  invoices: number;
  chased: number;
  recovered: number;
}

export interface RecoveryMonth {
  month: string;
  chased: number;
  recovered: number;
}

export interface RecoveryInvoiceRow {
  invoice_id: string;
  invoice_number: string;
  customer_name: string | null;
  first_reminder_at: string;
  reminders: number;
  chased: number;
  recovered: number;
  via_link: number;
  pending: number;
  days_to_pay: number | null;
}

export interface RecoveryReport {
  from: string;
  to: string;
  totals: RecoveryTotals;
  by_source: RecoveryBySource[];
  by_month: RecoveryMonth[];
  invoices: RecoveryInvoiceRow[];
}

const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

/** One row per invoice whose first sent reminder is in [$2, $3]; shared by every query below. */
const PER_INVOICE_CTE = `
  WITH rem AS (
    SELECT wm.reference_id AS invoice_id,
           MIN(wm.sent_at) AS first_at,
           COUNT(*)::int AS reminders,
           (ARRAY_AGG(COALESCE(wm.reminder_source, 'manual') ORDER BY wm.sent_at))[1] AS first_source,
           (ARRAY_AGG(wm.amount_due ORDER BY wm.sent_at))[1] AS first_amount_due
      FROM whatsapp_messages wm
     WHERE wm.business_id = $1 AND wm.message_type = 'reminder'
       AND wm.reference_type = 'invoice' AND wm.status = 'sent' AND wm.reference_id IS NOT NULL
     GROUP BY wm.reference_id
  ),
  inv AS (
    SELECT rem.*, i.invoice_number, c.name AS customer_name,
           CASE WHEN i.deleted_at IS NULL AND i.status = 'final'
                THEN GREATEST(COALESCE(i.balance_amount, 0), 0) ELSE 0 END AS balance_now,
           COALESCE((
             SELECT SUM(p.amount) FROM payments p
              WHERE p.business_id = $1 AND p.reference_type = 'invoice' AND p.reference_id = rem.invoice_id
                AND p.type = 'receivable' AND COALESCE(p.status, 'active') = 'active'
                AND p.created_at >= rem.first_at
           ), 0) AS paid_after,
           (
             SELECT MAX(p.created_at) FROM payments p
              WHERE p.business_id = $1 AND p.reference_type = 'invoice' AND p.reference_id = rem.invoice_id
                AND p.type = 'receivable' AND COALESCE(p.status, 'active') = 'active'
                AND p.created_at >= rem.first_at
           ) AS last_paid_at,
           COALESCE((
             SELECT SUM(a.amount) FROM invoice_online_payment_allocations a
               JOIN invoice_online_payments op ON op.id = a.online_payment_id
              WHERE a.business_id = $1 AND a.invoice_id = rem.invoice_id
                AND op.status = 'paid' AND op.paid_at >= rem.first_at
           ), 0) AS via_link
      FROM rem
      JOIN invoices i ON i.id = rem.invoice_id AND i.business_id = $1
      LEFT JOIN customers c ON c.id = i.customer_id
     WHERE rem.first_at >= $2::date AND rem.first_at < ($3::date + 1)
  ),
  calc AS (
    SELECT inv.*,
           GREATEST(COALESCE(first_amount_due, balance_now + paid_after), 0) AS chased
      FROM inv
  ),
  final AS (
    SELECT calc.*,
           LEAST(paid_after, chased) AS recovered,
           LEAST(via_link, LEAST(paid_after, chased)) AS via_link_capped,
           CASE WHEN balance_now <= 0.005 AND last_paid_at IS NOT NULL
                THEN GREATEST(EXTRACT(EPOCH FROM (last_paid_at - first_at)) / 86400.0, 0) END AS days_to_pay
      FROM calc
  )`;

export async function getReminderRecoveryReport(
  businessId: string,
  from: string,
  to: string,
): Promise<RecoveryReport> {
  const args = [businessId, from, to];

  const totalsRow = await queryOne<Record<string, unknown>>(
    `${PER_INVOICE_CTE}
     SELECT COUNT(*)::int AS invoices_reminded,
            COALESCE(SUM(chased), 0) AS chased,
            COALESCE(SUM(recovered), 0) AS recovered,
            COALESCE(SUM(via_link_capped), 0) AS recovered_via_link,
            COALESCE(SUM(balance_now), 0) AS pending,
            COUNT(*) FILTER (WHERE days_to_pay IS NOT NULL)::int AS invoices_fully_paid,
            AVG(days_to_pay) AS avg_days_to_pay
       FROM final`,
    args,
  );

  const sentRow = await queryOne<{ n: number }>(
    // A combined reminder is logged once per bill it chased; count it as one message.
    `SELECT COUNT(DISTINCT COALESCE(batch_id, id))::int AS n FROM whatsapp_messages
      WHERE business_id = $1 AND message_type = 'reminder' AND reference_type = 'invoice' AND status = 'sent'
        AND sent_at >= $2::date AND sent_at < ($3::date + 1)`,
    args,
  );

  const bySource = await queryRows<Record<string, unknown>>(
    `${PER_INVOICE_CTE}
     SELECT first_source AS source, COUNT(*)::int AS invoices,
            COALESCE(SUM(chased), 0) AS chased, COALESCE(SUM(recovered), 0) AS recovered
       FROM final GROUP BY first_source ORDER BY first_source`,
    args,
  );

  const byMonth = await queryRows<Record<string, unknown>>(
    `${PER_INVOICE_CTE}
     SELECT TO_CHAR(DATE_TRUNC('month', first_at), 'YYYY-MM') AS month,
            COALESCE(SUM(chased), 0) AS chased, COALESCE(SUM(recovered), 0) AS recovered
       FROM final GROUP BY 1 ORDER BY 1`,
    args,
  );

  const invoices = await queryRows<Record<string, unknown>>(
    `${PER_INVOICE_CTE}
     SELECT invoice_id, invoice_number, customer_name, first_at AS first_reminder_at, reminders,
            chased, recovered, via_link_capped AS via_link, balance_now AS pending, days_to_pay
       FROM final
      ORDER BY recovered DESC, chased DESC, first_at DESC
      LIMIT 100`,
    args,
  );

  const avg = totalsRow?.avg_days_to_pay;
  return {
    from,
    to,
    totals: {
      invoices_reminded: Number(totalsRow?.invoices_reminded ?? 0),
      reminders_sent: Number(sentRow?.n ?? 0),
      chased: num(totalsRow?.chased),
      recovered: num(totalsRow?.recovered),
      recovered_via_link: num(totalsRow?.recovered_via_link),
      pending: num(totalsRow?.pending),
      invoices_fully_paid: Number(totalsRow?.invoices_fully_paid ?? 0),
      avg_days_to_pay: avg == null ? null : Math.round(Number(avg) * 10) / 10,
    },
    by_source: bySource.map((r) => ({
      source: String(r.source) as RecoverySource,
      invoices: Number(r.invoices),
      chased: num(r.chased),
      recovered: num(r.recovered),
    })),
    by_month: byMonth.map((r) => ({ month: String(r.month), chased: num(r.chased), recovered: num(r.recovered) })),
    invoices: invoices.map((r) => ({
      invoice_id: String(r.invoice_id),
      invoice_number: String(r.invoice_number ?? ''),
      customer_name: (r.customer_name as string | null) ?? null,
      first_reminder_at: new Date(r.first_reminder_at as string).toISOString(),
      reminders: Number(r.reminders),
      chased: num(r.chased),
      recovered: num(r.recovered),
      via_link: num(r.via_link),
      pending: num(r.pending),
      days_to_pay: r.days_to_pay == null ? null : Math.round(Number(r.days_to_pay) * 10) / 10,
    })),
  };
}
