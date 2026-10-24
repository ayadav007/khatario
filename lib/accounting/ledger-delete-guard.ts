import type { PoolClient } from 'pg';

/**
 * Reasons accepted by the ledger delete trigger (migration 323). Document corrections never
 * delete: they reverse (lib/ledger-reversal.ts). Only system-generated vouchers are
 * regenerated, and only admin tools and tenant purge remove postings outright.
 */
export type LedgerDeleteReason =
  | 'tenant_purge'
  | 'admin:purge_invoices'
  | 'admin:seed_demo'
  | 'regenerate:year_close'
  | 'regenerate:tax_provision'
  | 'regenerate:opening_balance'
  | 'regenerate:opening_stock';

/**
 * Runs `fn` with ledger deletes allowed for `reason`. The setting is transaction-local,
 * so the client must be inside BEGIN; outside a transaction the trigger still refuses.
 */
export async function withLedgerDelete<T>(
  client: PoolClient,
  reason: LedgerDeleteReason,
  actorId: string | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  await client.query(
    `SELECT set_config('khatario.ledger_delete_reason', $1, true),
            set_config('khatario.actor_id', $2, true)`,
    [reason, actorId ?? '']
  );
  try {
    return await fn();
  } finally {
    await client
      .query(
        `SELECT set_config('khatario.ledger_delete_reason', '', true),
                set_config('khatario.actor_id', '', true)`
      )
      .catch(() => {});
  }
}
