import type { Pool } from 'pg';
import {
  createInvoiceInTransaction,
  InvoiceCreateServiceError,
  type CreateInvoiceItemInput,
} from '@/lib/invoices/invoice-create-service';
import { isPeriodLocked } from '@/lib/period-lock-utils';
import { addDays, dueRunDates, isRecurringFrequency, nextRunDate } from '@/lib/invoices/recurring-schedule';

export * from '@/lib/invoices/recurring-schedule';

export interface RecurringRunSummary {
  recurring_invoice_id: string;
  created: Array<{ run_date: string; invoice_id: string; invoice_number: string }>;
  skipped: string[];
  error?: string;
}

const toDateStr = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/**
 * Raises every due invoice. Each run date is its own transaction guarded by the unique
 * (recurring_invoice_id, run_date) history row, so a retry or overlapping cron never duplicates.
 */
export async function runRecurringInvoices(
  pool: Pool,
  p: { today: string; businessId?: string; recurringId?: string; actorUserId?: string }
): Promise<RecurringRunSummary[]> {
  const params: unknown[] = [p.today];
  let where = `ri.is_active = true AND ri.next_run_date <= $1::date AND (ri.end_date IS NULL OR ri.next_run_date <= ri.end_date)`;
  if (p.businessId) {
    params.push(p.businessId);
    where += ` AND ri.business_id = $${params.length}`;
  }
  if (p.recurringId) {
    params.push(p.recurringId);
    where += ` AND ri.id = $${params.length}`;
  }
  const recs = (await pool.query(`SELECT ri.* FROM recurring_invoices ri WHERE ${where} ORDER BY ri.next_run_date LIMIT 500`, params)).rows;

  const summaries: RecurringRunSummary[] = [];
  for (const rec of recs) {
    const summary: RecurringRunSummary = { recurring_invoice_id: rec.id, created: [], skipped: [] };
    summaries.push(summary);
    if (!isRecurringFrequency(rec.frequency)) {
      summary.error = `Unsupported frequency ${rec.frequency}`;
      continue;
    }
    const startDate = toDateStr(rec.start_date)!;
    const anchorDay = Number(startDate.slice(8, 10));
    const runs = dueRunDates({
      nextRun: toDateStr(rec.next_run_date)!,
      today: p.today,
      endDate: toDateStr(rec.end_date),
      frequency: rec.frequency,
      interval: rec.interval_value,
      anchorDay,
    });

    for (const runDate of runs) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const claim = await client.query(
          `INSERT INTO recurring_invoice_history (recurring_invoice_id, run_date, status)
           VALUES ($1, $2, 'processing')
           ON CONFLICT (recurring_invoice_id, run_date) DO NOTHING
           RETURNING id`,
          [rec.id, runDate]
        );
        const following = nextRunDate(runDate, rec.frequency, rec.interval_value, anchorDay);
        if (!claim.rows[0]) {
          await client.query(
            `UPDATE recurring_invoices SET next_run_date = GREATEST(next_run_date, $2::date), updated_at = CURRENT_TIMESTAMP
              WHERE id = $1`,
            [rec.id, following]
          );
          await client.query('COMMIT');
          summary.skipped.push(runDate);
          continue;
        }

        if (await isPeriodLocked(rec.business_id, rec.branch_id ?? null, runDate)) {
          throw new InvoiceCreateServiceError(`Period containing ${runDate} is locked`, 403, 'PERIOD_LOCKED');
        }

        let items: CreateInvoiceItemInput[] = Array.isArray(rec.items) ? rec.items : [];
        let dueDays: number | null = null;
        let placeOfSupply: string | null = null;
        let pricesIncludeGst = false;
        if (rec.template_invoice_id) {
          const tpl = (
            await client.query(
              `SELECT (due_date - invoice_date) AS due_days, place_of_supply_state_code, COALESCE(prices_include_gst, false) AS pig
                 FROM invoices WHERE id = $1 AND business_id = $2`,
              [rec.template_invoice_id, rec.business_id]
            )
          ).rows[0];
          if (tpl) {
            dueDays = tpl.due_days == null ? null : Number(tpl.due_days);
            placeOfSupply = tpl.place_of_supply_state_code;
            pricesIncludeGst = tpl.pig === true;
          }
          if (items.length === 0) {
            items = (
              await client.query(
                `SELECT item_id, variant_id, item_name, description, hsn_sac, quantity::float8 AS quantity, unit,
                        unit_price::float8 AS unit_price, discount_percent::float8 AS discount_percent,
                        tax_rate::float8 AS tax_rate
                   FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
                [rec.template_invoice_id]
              )
            ).rows;
          }
        }
        if (items.length === 0) throw new InvoiceCreateServiceError('Recurring invoice has no items', 400, 'NO_ITEMS');

        const actor =
          p.actorUserId ||
          rec.created_by ||
          (
            await client.query(
              `SELECT id FROM users WHERE business_id = $1 AND is_primary_admin = true ORDER BY created_at LIMIT 1`,
              [rec.business_id]
            )
          ).rows[0]?.id;
        if (!actor) throw new InvoiceCreateServiceError('No user to raise the invoice as', 400, 'NO_ACTOR');

        const dueDate = dueDays != null && dueDays >= 0 ? addDays(runDate, dueDays) : null;

        const status = rec.auto_finalize ? 'final' : 'draft';
        const created = await createInvoiceInTransaction(
          client,
          {
            business_id: rec.business_id,
            created_by: actor,
            branch_id: rec.branch_id || undefined,
            customer_id: rec.customer_id,
            invoice_date: runDate,
            due_date: dueDate,
            status,
            items,
            notes: [rec.notes, rec.terms].filter(Boolean).join('\n\n') || null,
            place_of_supply_state_code: placeOfSupply,
            prices_include_gst: pricesIncludeGst,
          },
          { allowDraft: true }
        );

        await client.query(
          `UPDATE recurring_invoice_history SET invoice_id = $1, status = 'success' WHERE id = $2`,
          [created.invoiceId, claim.rows[0].id]
        );
        await client.query(
          `UPDATE recurring_invoices
              SET next_run_date = $2::date, last_run_date = $3::date, last_error = NULL,
                  is_active = CASE WHEN end_date IS NOT NULL AND $2::date > end_date THEN false ELSE is_active END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [rec.id, following, runDate]
        );
        await client.query('COMMIT');
        summary.created.push({ run_date: runDate, invoice_id: created.invoiceId, invoice_number: created.invoiceNumber });
      } catch (e: any) {
        await client.query('ROLLBACK').catch(() => {});
        summary.error = `${runDate}: ${e?.message || 'failed'}`;
        await pool
          .query(`UPDATE recurring_invoices SET last_error = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
            rec.id,
            summary.error.slice(0, 1000),
          ])
          .catch(() => {});
        break;
      } finally {
        client.release();
      }
    }
  }
  return summaries;
}
