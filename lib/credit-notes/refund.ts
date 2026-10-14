import type { PoolClient } from 'pg';
import { insertVoucherLines, round2 } from '@/lib/accounting/voucher-posting';
import { listCashBankAccounts } from '@/lib/accounting/contra';
import { financialYearLabel } from '@/lib/accounting/advances';
import { listAvailableCustomerCredits } from '@/lib/credit-notes/customer-credit';

/**
 * Money paid back to a customer against a credit note (cash, UPI or bank).
 * Posts Dr receivable / Cr cash-or-bank, so the customer's credit balance comes back to zero for
 * the refunded part. Runs on the caller's transaction.
 */

export type RefundMode = 'cash' | 'upi' | 'bank';

export class CreditNoteRefundError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CreditNoteRefundError';
  }
}

export function isRefundMode(v: unknown): v is RefundMode {
  return v === 'cash' || v === 'upi' || v === 'bank';
}

/** What can still be paid back on this note (unused credit after bills it settled or was applied to). */
export async function refundableOnCreditNote(
  client: PoolClient,
  businessId: string,
  creditNoteId: string,
): Promise<{ customerId: string; refundable: number } | null> {
  const note = await client.query<{ customer_id: string }>(
    `SELECT customer_id FROM credit_notes WHERE id = $1 AND business_id = $2 AND status = 'active'`,
    [creditNoteId, businessId],
  );
  const customerId = note.rows[0]?.customer_id;
  if (!customerId) return null;
  const credits = await listAvailableCustomerCredits(client, businessId, customerId);
  const found = credits.notes.find((n) => n.id === creditNoteId);
  return { customerId, refundable: round2(found?.available ?? 0) };
}

export async function refundCreditNote(
  client: PoolClient,
  p: {
    businessId: string;
    userId: string;
    creditNoteId: string;
    amount?: number | null;
    mode: RefundMode;
    paymentAccountId?: string | null;
    date: string;
    reference?: string | null;
    notes?: string | null;
    orderReturnId?: string | null;
  },
): Promise<{ id: string; voucherNumber: string; amount: number; fullyRefunded: boolean }> {
  const locked = await client.query<{ id: string; branch_id: string | null; credit_note_number: string; refund_amount: string | null }>(
    `SELECT id, branch_id, credit_note_number, refund_amount::text
       FROM credit_notes WHERE id = $1 AND business_id = $2 AND status = 'active' FOR UPDATE`,
    [p.creditNoteId, p.businessId],
  );
  const note = locked.rows[0];
  if (!note) throw new CreditNoteRefundError(404, 'CREDIT_NOTE_NOT_FOUND', 'Credit note not found');

  const room = await refundableOnCreditNote(client, p.businessId, p.creditNoteId);
  const refundable = room?.refundable ?? 0;
  if (refundable <= 0.004) {
    throw new CreditNoteRefundError(409, 'NOTHING_TO_REFUND', 'This credit note has no unused credit left to pay back');
  }
  const amount = round2(p.amount == null ? refundable : Number(p.amount));
  if (!(amount > 0)) throw new CreditNoteRefundError(400, 'INVALID_AMOUNT', 'Refund amount must be greater than zero');
  if (amount > refundable + 0.005) {
    throw new CreditNoteRefundError(400, 'EXCEEDS_CREDIT', `Only ₹${refundable.toFixed(2)} can be refunded on this credit note`);
  }

  const accounts = await listCashBankAccounts(client, p.businessId);
  const wantKind = p.mode === 'cash' ? 'cash' : 'bank';
  const account = p.paymentAccountId
    ? accounts.find((a) => a.id === p.paymentAccountId)
    : accounts.find((a) => a.kind === wantKind) ?? accounts[0];
  if (!account) {
    throw new CreditNoteRefundError(400, 'NOT_CASH_OR_BANK', 'Choose a cash or bank account the refund was paid from');
  }

  const { getMappedAccountId } = await import('@/lib/account-mappings');
  const receivable = await getMappedAccountId(p.businessId, 'accounts_receivable_account_id', '1103', 'Accounts Receivable');
  if (!receivable) throw new Error('Accounts Receivable (1103) account not found; initialise the chart of accounts');

  const stem = `CNR/${financialYearLabel(p.date)}/`;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fy-voucher:${p.businessId}:${stem}`]);
  const seq = await client.query<{ max_seq: number | null }>(
    `SELECT MAX(CAST(SUBSTRING(voucher_number FROM '[0-9]+$') AS INTEGER)) AS max_seq
       FROM credit_note_refunds WHERE business_id = $1 AND voucher_number LIKE $2`,
    [p.businessId, `${stem}%`],
  );
  const voucherNumber = `${stem}${String(Number(seq.rows[0]?.max_seq || 0) + 1).padStart(5, '0')}`;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO credit_note_refunds
       (business_id, branch_id, credit_note_id, customer_id, order_return_id, amount, refund_date, mode,
        payment_account_id, reference, voucher_number, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      p.businessId,
      note.branch_id,
      p.creditNoteId,
      room!.customerId,
      p.orderReturnId ?? null,
      amount,
      p.date,
      p.mode,
      account.id,
      p.reference?.trim() || null,
      voucherNumber,
      p.notes?.trim() || null,
      p.userId,
    ],
  );
  const id = inserted.rows[0].id;

  const label = `Refund on ${note.credit_note_number} (${p.mode.toUpperCase()})`;
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: note.branch_id,
    voucherId: id,
    voucherType: 'credit_note_refund',
    entryDate: p.date,
    reference: voucherNumber,
    lines: [
      { accountId: receivable, debit: amount, credit: 0, narration: label },
      { accountId: account.id, debit: 0, credit: amount, narration: label },
    ],
  });

  // The credit note had lowered what the customer owes; paying it out brings that back.
  await client.query(
    `UPDATE customers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND business_id = $3`,
    [amount, room!.customerId, p.businessId],
  );

  const totalRefunded = round2((Number(note.refund_amount) || 0) + amount);
  const fullyRefunded = amount >= refundable - 0.005;
  await client.query(
    `UPDATE credit_notes
        SET refund_amount = $3,
            refund_mode = $4,
            refund_date = $5,
            refund_status = CASE WHEN $6::boolean THEN 'refunded' ELSE refund_status END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2`,
    [p.creditNoteId, p.businessId, totalRefunded, p.mode, p.date, fullyRefunded],
  );

  return { id, voucherNumber, amount, fullyRefunded };
}
