/**
 * SQL predicate for the ledgers that hold the business's money: cash in hand, bank accounts
 * and the bank overdraft / cash credit account (2112). It follows `settlementKind` in
 * settlement-accounts.ts for cash and bank, so a ledger a receipt or payment can land in is a
 * ledger the cash flow counts.
 *
 * Not cash: GST electronic cash / credit ledgers (money already paid to the portal) and
 * credit-card or payment-gateway clearing accounts (money not yet settled to a bank).
 *
 * `account` is the alias of the accounts row, `group` the alias of its account_groups row
 * (LEFT JOIN on accounts.account_group_id).
 */
export function cashAccountSql(account: string, group: string): string {
  const a = account;
  return `(
    ${a}.account_name !~* 'electronic[[:space:]]+(cash|credit)[[:space:]]+ledger'
    AND ${a}.account_name !~* 'credit[[:space:]]*card|payment[[:space:]]*gateway|gateway[[:space:]]*clearing|card[[:space:]]*clearing|card[[:space:]]*receivable|unsettled[[:space:]]*card'
    AND (
      ${a}.account_code LIKE '1101%' OR ${a}.account_code LIKE '1102%' OR ${a}.account_code LIKE '2112%'
      OR EXISTS (SELECT 1 FROM bank_accounts cash_ba
                  WHERE cash_ba.business_id = ${a}.business_id AND cash_ba.ledger_account_id = ${a}.id)
      OR (
        ${a}.account_type = 'asset'
        AND ${a}.account_name NOT ILIKE '%receivable%'
        AND (
          ${a}.account_name ~* '(^|[^a-z])cash([^a-z]|$)'
          OR (${a}.account_code LIKE '11%'
              AND (${a}.account_name ILIKE '%bank%' OR COALESCE(${group}.group_name, '') ILIKE '%bank%'))
        )
      )
    )
  )`;
}
