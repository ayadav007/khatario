import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { insertVoucherLines, round2, type VoucherLine } from '@/lib/accounting/voucher-posting';
import { CUSTOMER_VOUCHERS_SQL, customerIdForVoucher } from '@/lib/accounting/customer-vouchers';
import {
  ReceivableAccountError,
  assertReceivableTarget,
  receivableAccountIds,
  receivableControlAccountId,
  resolveCustomerReceivableAccountId,
} from '@/lib/accounting/receivable-accounts';
import { currentReversalDate } from '@/lib/accounting/payment-reversal';
import { isPeriodLocked } from '@/lib/period-lock-utils';
import * as schema from '@/lib/accounting/receivable-accounts-schema';

/**
 * Changing the receivable account a customer posts to.
 *
 * Entries already written stay where they are. What the customer owes in any other receivable
 * account is carried to the new one by a single `receivable_transfer` voucher dated today, so
 * earlier balance sheets and locked periods are untouched. From then on every line written for
 * the customer goes to the new account (see resolveCustomerReceivableAccountId and the reversal
 * redirect in lib/ledger-reversal.ts), which keeps the old account settled.
 */

export const RECEIVABLE_TRANSFER_VOUCHER = 'receivable_transfer';

export type ReceivableMoveResult = {
  /** `customers.receivable_account_id` was (or, in a dry run, would be) updated. */
  changed: boolean;
  /** The recorded move, also the transfer voucher's id. Null when nothing was recorded. */
  moveId: string | null;
  /** The account the customer posts to after the move (the control account when null was asked). */
  toAccountId: string;
  /** Date of the transfer voucher, when one was posted. */
  transferDate: string | null;
  /** Signed debit-minus-credit balance taken out of each other receivable account. */
  transfers: Array<{ fromAccountId: string; amount: number }>;
  transferredAmount: number;
};

type BranchBalance = { account_id: string; branch_id: string | null; net: number };

async function balancesByAccountAndBranch(
  client: PoolClient,
  businessId: string,
  customerId: string,
  accountIds: string[],
): Promise<BranchBalance[]> {
  if (accountIds.length === 0) return [];
  const res = await client.query<{ account_id: string; branch_id: string | null; net: string }>(
    `SELECT l.account_id, l.branch_id, SUM(l.debit - l.credit)::text AS net
       FROM ledger_entry_lines l
       JOIN (${CUSTOMER_VOUCHERS_SQL}) v
         ON v.voucher_type = l.voucher_type AND v.voucher_id = l.voucher_id
      WHERE l.business_id = $1 AND v.customer_id = $2 AND l.account_id = ANY($3::uuid[])
      GROUP BY l.account_id, l.branch_id
     HAVING ABS(SUM(l.debit - l.credit)) >= 0.005`,
    [businessId, customerId, accountIds],
  );
  return res.rows.map((r) => ({ account_id: r.account_id, branch_id: r.branch_id, net: round2(Number(r.net)) }));
}

/**
 * Lines of a customer's voucher that a move has carried away: they sit on a receivable account
 * the customer no longer posts to, and they were written before the customer's last move, whose
 * transfer settled that account. Reversing or re-posting such a line must act on the customer's
 * current account, or the old account is reopened.
 *
 * A line on another account that was written after the last move was never transferred (for
 * example one posted to Accounts Receivable while the customer's own account was unusable), and
 * a customer who was never moved has no such lines at all: both are left exactly as they are.
 * Returns null when there is nothing to do, after one cheap query for a business with no moves.
 */
export async function customerSweptLines(
  client: PoolClient,
  p: {
    businessId: string;
    voucherType: string;
    voucherId: string;
    lines: Array<{ id: string; account_id: string }>;
  },
): Promise<{ customerId: string; currentAccountId: string; sweptLineIds: Set<string> } | null> {
  if (p.lines.length === 0) return null;
  if (!(await schema.hasCustomerReceivableAccounts())) return null;
  const anyMove = await client.query(
    `SELECT 1 FROM customer_receivable_account_moves WHERE business_id = $1 AND kind = 'move' LIMIT 1`,
    [p.businessId],
  );
  if (anyMove.rows.length === 0) return null;

  const accountIds = new Set(await receivableAccountIds(p.businessId, client));
  const candidates = p.lines.filter((l) => accountIds.has(l.account_id));
  if (candidates.length === 0) return null;
  const customerId = await customerIdForVoucher(client, p.businessId, p.voucherType, p.voucherId);
  if (!customerId) return null;

  let currentAccountId: string;
  try {
    currentAccountId = await resolveCustomerReceivableAccountId(p.businessId, customerId, client);
  } catch {
    // No usable receivable control account: there is nowhere to carry a line to.
    return null;
  }
  const elsewhere = candidates.filter((l) => l.account_id !== currentAccountId).map((l) => l.id);
  if (elsewhere.length === 0) return null;

  // Compared in the database: a move's time is the clock at the moment it was recorded, after
  // every posting in flight had finished, so "written before the last move" means "transferred".
  const swept = await client.query<{ id: string }>(
    `SELECT l.id
       FROM ledger_entry_lines l
      WHERE l.business_id = $1 AND l.id = ANY($2::uuid[])
        AND l.created_at < (
          SELECT MAX(m.created_at) FROM customer_receivable_account_moves m
           WHERE m.business_id = $1 AND m.customer_id = $3 AND m.kind = 'move'
        )`,
    [p.businessId, elsewhere, customerId],
  );
  if (swept.rows.length === 0) return null;
  return { customerId, currentAccountId, sweptLineIds: new Set(swept.rows.map((r) => r.id)) };
}

/**
 * Called when lines of a customer's document are reversed and some of them sit on a receivable
 * account the customer has since been moved out of. The mirror lines had to go on that old
 * account; this posts, on the same date and branch, the entry that carries them to the
 * customer's current account, so the old account stays settled. Runs on the caller's transaction.
 *
 * `reversedLines` are the original lines (their own debit and credit), not the mirrors.
 */
export async function postReceivableCorrection(
  client: PoolClient,
  p: {
    businessId: string;
    customerId: string;
    toAccountId: string;
    sourceVoucherType: string;
    sourceVoucherId: string;
    actorId: string | null;
    reversedLines: Array<{
      accountId: string;
      branchId: string | null;
      entryDate: string | Date;
      debit: number;
      credit: number;
    }>;
  },
): Promise<string | null> {
  const lines = p.reversedLines.filter((l) => round2(l.debit) !== 0 || round2(l.credit) !== 0);
  if (lines.length === 0) return null;

  const moveId = randomUUID();
  // What lands in the current account: the mirror of each original line.
  const carried = round2(lines.reduce((sum, l) => sum + l.credit - l.debit, 0));
  await client.query(
    `INSERT INTO customer_receivable_account_moves
       (id, business_id, customer_id, to_account_id, transfer_date, transferred_amount, created_by,
        kind, source_voucher_type, source_voucher_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'correction', $8, $9)`,
    [
      moveId, p.businessId, p.customerId, p.toAccountId, lines[0].entryDate, carried, p.actorId,
      p.sourceVoucherType, p.sourceVoucherId,
    ],
  );

  const narration = `Reversal of ${p.sourceVoucherType.replace(/_/g, ' ')} carried to the customer's current receivable account`;
  const groupKey = (l: (typeof lines)[number]) =>
    `${l.branchId ?? ''}|${l.entryDate instanceof Date ? l.entryDate.getTime() : l.entryDate}`;
  const groups = new Map<string, typeof lines>();
  for (const l of lines) groups.set(groupKey(l), [...(groups.get(groupKey(l)) ?? []), l]);

  for (const group of groups.values()) {
    const voucherLines: VoucherLine[] = [];
    for (const l of group) {
      // Undo the mirror on the old account, and put the mirror on the current one.
      voucherLines.push({ accountId: l.accountId, debit: l.debit, credit: l.credit, narration });
      voucherLines.push({ accountId: p.toAccountId, debit: l.credit, credit: l.debit, narration });
    }
    await insertVoucherLines(client, {
      businessId: p.businessId,
      branchId: group[0].branchId,
      voucherId: moveId,
      voucherType: RECEIVABLE_TRANSFER_VOUCHER,
      entryDate: group[0].entryDate,
      reference: null,
      lines: voucherLines,
    });
  }
  return moveId;
}

/**
 * Sets the customer's receivable account (`toAccountId` null = the control account) and carries
 * over any balance the customer has in other receivable accounts. Choosing the account the
 * customer already has still sweeps such a balance, and does nothing when there is none.
 * `dryRun` reports what would happen and writes nothing.
 */
export async function moveCustomerReceivableAccount(p: {
  businessId: string;
  customerId: string;
  toAccountId: string | null;
  actorId: string | null;
  dryRun?: boolean;
}): Promise<ReceivableMoveResult> {
  if (!(await schema.hasCustomerReceivableAccounts())) {
    throw new ReceivableAccountError(
      'Receivable accounts for customers need database migration 468.',
      'RECEIVABLE_ACCOUNTS_UNAVAILABLE',
    );
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE waits for postings in flight: they hold FOR KEY SHARE on the customer row.
    const found = await client.query<{ name: string; receivable_account_id: string | null }>(
      `SELECT name, receivable_account_id
         FROM customers
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [p.customerId, p.businessId],
    );
    const customer = found.rows[0];
    if (!customer) throw new ReceivableAccountError('Customer not found', 'NOT_FOUND', 404);

    const toAccountId = await assertReceivableTarget(p.businessId, p.toAccountId, client);
    const controlAccountId = await receivableControlAccountId(p.businessId);
    const stored = toAccountId === controlAccountId ? null : toAccountId;
    const changed = (customer.receivable_account_id ?? null) !== stored;

    const others = (await receivableAccountIds(p.businessId, client)).filter((id) => id !== toAccountId);
    const balances = await balancesByAccountAndBranch(client, p.businessId, p.customerId, others);

    const byAccount = new Map<string, number>();
    for (const b of balances) byAccount.set(b.account_id, round2((byAccount.get(b.account_id) ?? 0) + b.net));
    const transfers = [...byAccount.entries()].map(([fromAccountId, amount]) => ({ fromAccountId, amount }));
    const transferredAmount = round2(balances.reduce((sum, b) => sum + b.net, 0));

    if (!changed && balances.length === 0) {
      await client.query('ROLLBACK');
      return { changed: false, moveId: null, toAccountId, transferDate: null, transfers: [], transferredAmount: 0 };
    }

    const today = await currentReversalDate(client);
    if (balances.length > 0) {
      const branches = [...new Set(balances.map((b) => b.branch_id))];
      for (const branchId of branches) {
        if (await isPeriodLocked(p.businessId, branchId, today)) {
          throw new ReceivableAccountError(
            'Today falls in a locked period, so the balance cannot be transferred. Unlock the period and try again.',
            'PERIOD_LOCKED',
          );
        }
      }
    }

    const result: ReceivableMoveResult = {
      changed,
      moveId: null,
      toAccountId,
      transferDate: balances.length > 0 ? today : null,
      transfers,
      transferredAmount,
    };
    if (p.dryRun) {
      await client.query('ROLLBACK');
      return result;
    }

    const moveId = randomUUID();
    await client.query(
      `INSERT INTO customer_receivable_account_moves
         (id, business_id, customer_id, to_account_id, transfer_date, transferred_amount, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())`,
      [moveId, p.businessId, p.customerId, toAccountId, today, transferredAmount, p.actorId],
    );

    // One balanced set of lines per branch, so each branch's books show the move too.
    const narration = `Receivable account changed - ${customer.name}`;
    const branchIds = [...new Set(balances.map((b) => b.branch_id))];
    for (const branchId of branchIds) {
      const lines: VoucherLine[] = [];
      for (const b of balances.filter((x) => x.branch_id === branchId)) {
        const amount = Math.abs(b.net);
        if (b.net > 0) {
          lines.push({ accountId: toAccountId, debit: amount, credit: 0, narration });
          lines.push({ accountId: b.account_id, debit: 0, credit: amount, narration });
        } else {
          lines.push({ accountId: b.account_id, debit: amount, credit: 0, narration });
          lines.push({ accountId: toAccountId, debit: 0, credit: amount, narration });
        }
      }
      await insertVoucherLines(client, {
        businessId: p.businessId,
        branchId,
        voucherId: moveId,
        voucherType: RECEIVABLE_TRANSFER_VOUCHER,
        entryDate: today,
        reference: customer.name.slice(0, 100),
        lines,
      });
    }

    if (changed) {
      await client.query(
        `UPDATE customers SET receivable_account_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND business_id = $3`,
        [stored, p.customerId, p.businessId],
      );
    }

    await client.query('COMMIT');
    return { ...result, moveId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
