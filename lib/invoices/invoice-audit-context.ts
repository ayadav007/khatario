/**
 * Tells the invoice edit log (migration 469) who is changing an invoice, what they are doing and
 * why. The database records every change on its own; this only fills in the actor, action and
 * reason. Settings are transaction-local: call it on a client inside BEGIN, before the writes.
 * Outside a transaction it applies to nothing.
 */
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';

export type InvoiceAuditAction =
  | 'created'
  | 'draft_edited'
  | 'finalized'
  | 'amended'
  | 'cancelled'
  | 'payment_recorded'
  | 'payment_reversed'
  | 'credit_note_applied'
  | 'credit_note_cancelled'
  | 'debit_note_applied'
  | 'debit_note_cancelled'
  | 'converted'
  | 'eway_updated'
  | 'restored'
  | 'gstr1_locked'
  | 'proforma_status'
  | 'store_order'
  | 'item_merged';

export const CHANGE_REASON_MAX = 500;

/** Trimmed reason, null when blank, 'too_long' past 500 characters. */
export function parseChangeReason(value: unknown): string | null | 'too_long' {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > CHANGE_REASON_MAX ? 'too_long' : text;
}

export async function setInvoiceAuditContext(
  client: Pick<PoolClient, 'query'>,
  ctx: { actorUserId: string | null | undefined; action: InvoiceAuditAction; reason?: string | null },
): Promise<void> {
  const reason = ctx.reason ? String(ctx.reason).trim().slice(0, CHANGE_REASON_MAX) : '';
  await client.query(
    `SELECT set_config('khatario.invoice_actor_id', $1, true),
            set_config('khatario.invoice_action', $2, true),
            set_config('khatario.invoice_reason', $3, true)`,
    [ctx.actorUserId ?? '', ctx.action, reason],
  );
}

type AuditContext = Parameters<typeof setInvoiceAuditContext>[1];

/** Runs `fn` in its own transaction with the audit context set. For routes that write once. */
export async function runWithInvoiceAudit<T>(ctx: AuditContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await setInvoiceAuditContext(client, ctx);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
