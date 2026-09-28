import type { PoolClient } from 'pg';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Statement credit (deposit) is +, debit (withdrawal) is −, i.e. the Dr − Cr it should have in the bank ledger. */
export function signedStatementAmount(debit: unknown, credit: unknown): number {
  return r2(Number(credit || 0) - Number(debit || 0));
}

export interface BrsLedgerItem {
  id: string;
  entry_date: string;
  debit: number;
  credit: number;
  narration: string | null;
  reference_number: string | null;
  voucher_type: string;
}

export interface BrsBankItem {
  id: string;
  transaction_date: string;
  description: string;
  debit_amount: number;
  credit_amount: number;
  cheque_number: string | null;
}

export interface BrsResult {
  balance_per_books: number;
  add_cheques_issued_not_presented: number;
  less_deposits_not_credited: number;
  less_bank_debits_not_in_books: number;
  add_bank_credits_not_in_books: number;
  balance_per_bank_computed: number;
  balance_per_bank_statement: number | null;
  unexplained_difference: number | null;
}

/**
 * Balance per bank = balance per books
 *   + cheques issued but not yet presented (book credits missing from the statement)
 *   − deposits not yet credited (book debits missing from the statement)
 *   − bank charges / debits not booked
 *   + interest / credits not booked
 * Balances are Dr-positive (overdraft is negative).
 */
export function computeBrs(input: {
  bookBalance: number;
  ledgerItemsNotOnStatement: Array<Pick<BrsLedgerItem, 'debit' | 'credit'>>;
  bankItemsNotInBooks: Array<Pick<BrsBankItem, 'debit_amount' | 'credit_amount'>>;
  statementBalance: number | null;
}): BrsResult {
  const unpresented = r2(input.ledgerItemsNotOnStatement.reduce((s, l) => s + Number(l.credit || 0), 0));
  const uncredited = r2(input.ledgerItemsNotOnStatement.reduce((s, l) => s + Number(l.debit || 0), 0));
  const bankDebits = r2(input.bankItemsNotInBooks.reduce((s, l) => s + Number(l.debit_amount || 0), 0));
  const bankCredits = r2(input.bankItemsNotInBooks.reduce((s, l) => s + Number(l.credit_amount || 0), 0));
  const computed = r2(input.bookBalance + unpresented - uncredited - bankDebits + bankCredits);
  return {
    balance_per_books: r2(input.bookBalance),
    add_cheques_issued_not_presented: unpresented,
    less_deposits_not_credited: uncredited,
    less_bank_debits_not_in_books: bankDebits,
    add_bank_credits_not_in_books: bankCredits,
    balance_per_bank_computed: computed,
    balance_per_bank_statement: input.statementBalance == null ? null : r2(input.statementBalance),
    unexplained_difference: input.statementBalance == null ? null : r2(input.statementBalance - computed),
  };
}

const MATCHED_IDS_CTE = `
  matched AS (
    SELECT bsl.matched_ledger_entry_id AS id
      FROM bank_statement_lines bsl
     WHERE bsl.business_id = $1 AND bsl.transaction_date <= $3::date AND bsl.matched_ledger_entry_id IS NOT NULL
    UNION
    SELECT e.value::uuid
      FROM bank_statement_lines bsl,
           jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(bsl.matched_ledger_ids) = 'array' THEN bsl.matched_ledger_ids ELSE '[]'::jsonb END
           ) AS e(value)
     WHERE bsl.business_id = $1 AND bsl.transaction_date <= $3::date
  )`;

export async function loadBrs(
  client: PoolClient,
  p: { businessId: string; bankAccountId: string; asOnDate: string }
): Promise<
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      bank_account: { id: string; account_name: string; bank_name: string | null; account_number: string | null };
      window_start: string;
      as_on_date: string;
      result: BrsResult;
      ledger_items_not_on_statement: BrsLedgerItem[];
      bank_items_not_in_books: BrsBankItem[];
    }
> {
  const bank = (
    await client.query(
      `SELECT id, account_name, bank_name, account_number, ledger_account_id
         FROM bank_accounts WHERE id = $1 AND business_id = $2`,
      [p.bankAccountId, p.businessId]
    )
  ).rows[0];
  if (!bank) return { ok: false, status: 404, error: 'Bank account not found' };
  if (!bank.ledger_account_id) return { ok: false, status: 400, error: 'Bank account is not linked to a ledger account' };

  const win = (
    await client.query<{ start: string | null }>(
      `SELECT MIN(statement_period_start)::text AS start
         FROM bank_statements WHERE business_id = $1 AND bank_account_id = $2`,
      [p.businessId, p.bankAccountId]
    )
  ).rows[0];
  if (!win?.start) return { ok: false, status: 400, error: 'Import a bank statement for this account first' };

  const book = (
    await client.query<{ bal: string }>(
      `SELECT COALESCE(SUM(debit - credit), 0)::text AS bal
         FROM ledger_entry_lines
        WHERE business_id = $1 AND account_id = $2 AND entry_date <= $3::date`,
      [p.businessId, bank.ledger_account_id, p.asOnDate]
    )
  ).rows[0];
  const opening = (
    await client.query<{ ob: string; t: string }>(
      `SELECT COALESCE(opening_balance, 0)::text AS ob, COALESCE(opening_balance_type, 'debit') AS t
         FROM accounts WHERE id = $1 AND business_id = $2`,
      [bank.ledger_account_id, p.businessId]
    )
  ).rows[0];
  const openingSigned = opening ? Number(opening.ob) * (/^c/i.test(opening.t) ? -1 : 1) : 0;
  const bookBalance = Number(book?.bal || 0) + openingSigned;

  const ledgerItems = (
    await client.query(
      `WITH ${MATCHED_IDS_CTE}
       SELECT lel.id, lel.entry_date::text, lel.debit::float8 AS debit, lel.credit::float8 AS credit,
              lel.narration, lel.reference_number, lel.voucher_type
         FROM ledger_entry_lines lel
        WHERE lel.business_id = $1 AND lel.account_id = $2
          AND lel.entry_date BETWEEN $4::date AND $3::date
          AND lel.id NOT IN (SELECT id FROM matched WHERE id IS NOT NULL)
        ORDER BY lel.entry_date, lel.id`,
      [p.businessId, bank.ledger_account_id, p.asOnDate, win.start]
    )
  ).rows as BrsLedgerItem[];

  const bankItems = (
    await client.query(
      `SELECT bsl.id, bsl.transaction_date::text, bsl.description,
              COALESCE(bsl.debit_amount, 0)::float8 AS debit_amount,
              COALESCE(bsl.credit_amount, 0)::float8 AS credit_amount,
              bsl.cheque_number
         FROM bank_statement_lines bsl
         JOIN bank_statements bs ON bs.id = bsl.bank_statement_id
        WHERE bsl.business_id = $1 AND bs.bank_account_id = $2 AND bsl.transaction_date <= $3::date
          AND COALESCE(bsl.match_status, '') <> 'ignored'
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entry_lines lel
             WHERE lel.business_id = $1 AND lel.entry_date <= $3::date
               AND lel.id IN (
                 SELECT bsl.matched_ledger_entry_id
                 UNION ALL
                 SELECT e.value::uuid FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(bsl.matched_ledger_ids) = 'array' THEN bsl.matched_ledger_ids ELSE '[]'::jsonb END
                 ) AS e(value)
               )
          )
        ORDER BY bsl.transaction_date, bsl.id`,
      [p.businessId, p.bankAccountId, p.asOnDate]
    )
  ).rows as BrsBankItem[];

  const stmtBal = (
    await client.query<{ balance: string | null }>(
      `SELECT COALESCE(
                (SELECT bsl.balance FROM bank_statement_lines bsl
                   JOIN bank_statements bs ON bs.id = bsl.bank_statement_id
                  WHERE bsl.business_id = $1 AND bs.bank_account_id = $2
                    AND bsl.transaction_date <= $3::date AND bsl.balance IS NOT NULL
                  ORDER BY bsl.transaction_date DESC, bsl.created_at DESC, bsl.id DESC LIMIT 1),
                (SELECT closing_balance FROM bank_statements
                  WHERE business_id = $1 AND bank_account_id = $2 AND statement_period_end <= $3::date
                  ORDER BY statement_period_end DESC LIMIT 1)
              )::text AS balance`,
      [p.businessId, p.bankAccountId, p.asOnDate]
    )
  ).rows[0];

  return {
    ok: true,
    bank_account: {
      id: bank.id,
      account_name: bank.account_name,
      bank_name: bank.bank_name,
      account_number: bank.account_number,
    },
    window_start: win.start,
    as_on_date: p.asOnDate,
    result: computeBrs({
      bookBalance,
      ledgerItemsNotOnStatement: ledgerItems,
      bankItemsNotInBooks: bankItems,
      statementBalance: stmtBal?.balance == null ? null : Number(stmtBal.balance),
    }),
    ledger_items_not_on_statement: ledgerItems,
    bank_items_not_in_books: bankItems,
  };
}
