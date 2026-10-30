import type { PoolClient } from 'pg';
import { insertVoucherLines, requireAccountByCode, round2, type VoucherLine } from '@/lib/accounting/voucher-posting';
import { listCashBankAccounts } from '@/lib/accounting/contra';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';

/**
 * Inter-branch balances: an inter-branch invoice (s.25(4), Sch I para 2) leaves Inter-Branch
 * Receivables (1109) at the sending branch and, once the receiving branch has booked it, Inter-Branch
 * Payables (2111) there. These are settled between the two branches, never by a customer payment.
 */

export const SETTLEMENT_VOUCHER = 'inter_branch_settlement';

export class InterBranchSettlementError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'InterBranchSettlementError';
  }
}

export interface InterBranchBalance {
  /** Branch that owes (its 2111). */
  payer_branch_id: string;
  payer_branch_name: string;
  /** Branch that is owed (its 1109). */
  payee_branch_id: string;
  payee_branch_name: string;
  invoiced: number;
  settled: number;
  open: number;
}

/**
 * What each branch owes each other branch: inter-branch invoices the receiver has booked (net of
 * credit notes), less payments from payer to payee, less nettings in either direction.
 */
export async function interBranchBalances(client: Pick<PoolClient, 'query'>, businessId: string): Promise<InterBranchBalance[]> {
  const { rows } = await client.query<{
    payer_branch_id: string;
    payer_branch_name: string;
    payee_branch_id: string;
    payee_branch_name: string;
    invoiced: string;
    settled: string;
  }>(
    `WITH invoiced AS (
       SELECT c.branch_id AS payer, i.branch_id AS payee,
              SUM(i.grand_total - COALESCE((SELECT SUM(cn.grand_total) FROM credit_notes cn
                                             WHERE cn.invoice_id = i.id AND cn.status = 'active'), 0)) AS amount
         FROM invoices i
         JOIN customers c ON c.id = i.customer_id AND c.customer_type = 'branch'
        WHERE i.business_id = $1 AND i.document_type = 'inter_branch_invoice'
          AND i.status <> 'cancelled' AND i.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM ledger_entry_lines l
                       WHERE l.business_id = i.business_id AND l.voucher_id = i.id AND l.voucher_type = 'inter_branch_receipt')
        GROUP BY c.branch_id, i.branch_id
     ),
     settled AS (
       SELECT payer_branch_id AS payer, payee_branch_id AS payee, amount FROM inter_branch_settlements
        WHERE business_id = $1 AND reversed_at IS NULL
       UNION ALL
       -- A netting clears the same amount in the opposite direction too.
       SELECT payee_branch_id, payer_branch_id, amount FROM inter_branch_settlements
        WHERE business_id = $1 AND reversed_at IS NULL AND mode = 'netting'
     ),
     pairs AS (
       SELECT payer, payee FROM invoiced UNION SELECT payer, payee FROM settled
     )
     SELECT p.payer AS payer_branch_id, pb.name AS payer_branch_name,
            p.payee AS payee_branch_id, qb.name AS payee_branch_name,
            COALESCE((SELECT SUM(amount) FROM invoiced v WHERE v.payer = p.payer AND v.payee = p.payee), 0) AS invoiced,
            COALESCE((SELECT SUM(amount) FROM settled s WHERE s.payer = p.payer AND s.payee = p.payee), 0) AS settled
       FROM pairs p
       JOIN branches pb ON pb.id = p.payer
       JOIN branches qb ON qb.id = p.payee
      ORDER BY pb.name, qb.name`,
    [businessId]
  );
  return rows.map((r) => {
    const invoiced = round2(Number(r.invoiced));
    const settled = round2(Number(r.settled));
    return { ...r, invoiced, settled, open: round2(invoiced - settled) };
  });
}

function openBetween(balances: InterBranchBalance[], payer: string, payee: string): number {
  return balances.find((b) => b.payer_branch_id === payer && b.payee_branch_id === payee)?.open ?? 0;
}

/** Records and posts a settlement. Must run inside a transaction. */
export async function settleInterBranchBalance(
  client: PoolClient,
  p: {
    businessId: string;
    userId: string;
    payerBranchId: string;
    payeeBranchId: string;
    mode: 'payment' | 'netting';
    amount: number;
    date: string;
    payerAccountId?: string | null;
    payeeAccountId?: string | null;
    reference?: string | null;
    notes?: string | null;
  }
): Promise<{ id: string }> {
  const amount = round2(Number(p.amount));
  if (!(amount > 0)) throw new InterBranchSettlementError(400, 'INVALID_AMOUNT', 'Enter an amount above zero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) throw new InterBranchSettlementError(400, 'INVALID_DATE', 'Date (YYYY-MM-DD) is required');
  if (p.payerBranchId === p.payeeBranchId) {
    throw new InterBranchSettlementError(400, 'SAME_BRANCH', 'Choose two different branches');
  }
  if (p.mode !== 'payment' && p.mode !== 'netting') {
    throw new InterBranchSettlementError(400, 'INVALID_MODE', 'Mode must be payment or netting');
  }

  // One settlement at a time per business, so two cannot both use the same open balance.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`inter-branch-settlement:${p.businessId}`]);
  const balances = await interBranchBalances(client, p.businessId);
  const owed = openBetween(balances, p.payerBranchId, p.payeeBranchId);
  const limit = p.mode === 'netting' ? Math.min(owed, openBetween(balances, p.payeeBranchId, p.payerBranchId)) : owed;
  if (amount > limit + 0.005) {
    throw new InterBranchSettlementError(
      409,
      'MORE_THAN_OPEN',
      p.mode === 'netting'
        ? `Only ₹${limit.toFixed(2)} can be netted: the smaller of what the two branches owe each other.`
        : `Only ₹${limit.toFixed(2)} is open from this branch to the other.`
    );
  }

  if (p.mode === 'payment') {
    const cashBank = new Set((await listCashBankAccounts(client, p.businessId)).map((a) => a.id));
    if (!p.payerAccountId || !cashBank.has(p.payerAccountId) || !p.payeeAccountId || !cashBank.has(p.payeeAccountId)) {
      throw new InterBranchSettlementError(400, 'NOT_CASH_OR_BANK', 'Choose the cash or bank account each branch used');
    }
  }

  const row = (
    await client.query<{ id: string }>(
      `INSERT INTO inter_branch_settlements (
         business_id, payer_branch_id, payee_branch_id, mode, amount, settlement_date,
         payer_account_id, payee_account_id, reference, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        p.businessId, p.payerBranchId, p.payeeBranchId, p.mode, amount, p.date,
        p.mode === 'payment' ? p.payerAccountId : null, p.mode === 'payment' ? p.payeeAccountId : null,
        p.reference ?? null, p.notes ?? null, p.userId,
      ]
    )
  ).rows[0];

  const receivable = await requireAccountByCode(client, p.businessId, '1109', 'Inter-Branch Receivables');
  const payable = await requireAccountByCode(client, p.businessId, '2111', 'Inter-Branch Payables');
  const label = p.mode === 'netting' ? 'Inter-branch balances netted' : 'Inter-branch settlement';
  const post = (branchId: string, lines: VoucherLine[]) =>
    insertVoucherLines(client, {
      businessId: p.businessId,
      branchId,
      voucherId: row.id,
      voucherType: SETTLEMENT_VOUCHER,
      entryDate: p.date,
      reference: p.reference ?? null,
      lines,
    });

  // Each branch's own lines balance, so branch books stay balanced.
  if (p.mode === 'payment') {
    await post(p.payerBranchId, [
      { accountId: payable, debit: amount, credit: 0, narration: label },
      { accountId: p.payerAccountId!, debit: 0, credit: amount, narration: label },
    ]);
    await post(p.payeeBranchId, [
      { accountId: p.payeeAccountId!, debit: amount, credit: 0, narration: label },
      { accountId: receivable, debit: 0, credit: amount, narration: label },
    ]);
  } else {
    for (const branchId of [p.payerBranchId, p.payeeBranchId]) {
      await post(branchId, [
        { accountId: payable, debit: amount, credit: 0, narration: label },
        { accountId: receivable, debit: 0, credit: amount, narration: label },
      ]);
    }
  }
  return { id: row.id };
}

/** Reverses a settlement's postings and frees its amount again. Must run inside a transaction. */
export async function reverseInterBranchSettlement(
  client: PoolClient,
  p: { businessId: string; settlementId: string; userId: string; date?: string | null }
): Promise<void> {
  const s = (
    await client.query(
      `SELECT id, reversed_at FROM inter_branch_settlements WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [p.settlementId, p.businessId]
    )
  ).rows[0];
  if (!s) throw new InterBranchSettlementError(404, 'NOT_FOUND', 'Settlement not found');
  if (s.reversed_at) throw new InterBranchSettlementError(409, 'ALREADY_REVERSED', 'This settlement is already reversed');
  await reverseVoucherLedgerEntries(client, {
    businessId: p.businessId,
    voucherType: SETTLEMENT_VOUCHER,
    voucherId: p.settlementId,
    reason: 'Inter-branch settlement reversed',
    entryDate: p.date ?? null,
    actorId: p.userId,
  });
  await client.query(
    `UPDATE inter_branch_settlements SET reversed_at = CURRENT_TIMESTAMP, reversed_by = $2 WHERE id = $1`,
    [p.settlementId, p.userId]
  );
}
