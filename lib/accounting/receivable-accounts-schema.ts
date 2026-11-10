import { queryOne } from '@/lib/db';

let cached: Promise<boolean> | null = null;

/**
 * True once migration 468 has added `customers.receivable_account_id` and the moves table.
 * Posting and reversals run on every sale, so they must keep working on a database where the
 * migration has not been applied yet: until then every customer posts to the control account.
 * Only a positive answer is cached.
 */
export function hasCustomerReceivableAccounts(): Promise<boolean> {
  if (!cached) {
    // Promise.resolve: reversals reach this from unit tests that stub the database module.
    cached = Promise.resolve(
      queryOne<{ ok: boolean }>(
        `SELECT to_regclass('customer_receivable_account_moves') IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'customers'
                 AND column_name = 'receivable_account_id'
            ) AS ok`,
      ),
    ).then(
      (r) => {
        if (!r?.ok) cached = null;
        return !!r?.ok;
      },
      (e) => {
        cached = null;
        throw e;
      },
    );
  }
  return cached;
}
