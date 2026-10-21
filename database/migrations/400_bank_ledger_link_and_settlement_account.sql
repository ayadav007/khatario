-- Bank register rows used for import and reconciliation must point at a chart ledger.
-- Receipts and payments store the cash, bank or clearing account they posted to.
-- Historical rows stay null: their ledger lines are already posted and are not rewritten.
-- Re-running this migration does not create ledgers or opening balances.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS settlement_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS settlement_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_payments_settlement_account
  ON payments (settlement_account_id)
  WHERE settlement_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_settlement_account
  ON expenses (settlement_account_id)
  WHERE settlement_account_id IS NOT NULL;

-- Join a bank register row to a chart ledger only when both sides are unambiguous.
-- Does not insert accounts and does not post opening balances.
DO $$
DECLARE
  r RECORD;
  ledger UUID;
  n_banks INT;
  n_ledgers INT;
BEGIN
  FOR r IN
    SELECT DISTINCT business_id FROM bank_accounts WHERE ledger_account_id IS NULL
  LOOP
    SELECT COUNT(*) INTO n_banks
      FROM bank_accounts
     WHERE business_id = r.business_id AND ledger_account_id IS NULL;

    SELECT COUNT(*) INTO n_ledgers
      FROM accounts a
      LEFT JOIN account_groups ag ON ag.id = a.account_group_id
     WHERE a.business_id = r.business_id
       AND COALESCE(a.is_active, true)
       AND NOT EXISTS (
         SELECT 1 FROM bank_accounts ba
          WHERE ba.business_id = a.business_id AND ba.ledger_account_id = a.id
       )
       AND (
         a.account_code IN ('1102', '2112')
         OR (
           a.account_type = 'asset'
           AND a.account_code LIKE '11%'
           AND a.account_code <> '1101'
           AND (
             a.account_name ILIKE '%bank%'
             OR COALESCE(ag.group_name, '') ILIKE '%bank%'
           )
           AND a.account_name NOT ILIKE '%cash%'
         )
       );

    IF n_banks = 1 AND n_ledgers = 1 THEN
      SELECT a.id INTO ledger
        FROM accounts a
        LEFT JOIN account_groups ag ON ag.id = a.account_group_id
       WHERE a.business_id = r.business_id
         AND COALESCE(a.is_active, true)
         AND NOT EXISTS (
           SELECT 1 FROM bank_accounts ba
            WHERE ba.business_id = a.business_id AND ba.ledger_account_id = a.id
         )
         AND (
           a.account_code IN ('1102', '2112')
           OR (
             a.account_type = 'asset'
             AND a.account_code LIKE '11%'
             AND a.account_code <> '1101'
             AND (
               a.account_name ILIKE '%bank%'
               OR COALESCE(ag.group_name, '') ILIKE '%bank%'
             )
             AND a.account_name NOT ILIKE '%cash%'
           )
         )
       LIMIT 1;

      UPDATE bank_accounts
         SET ledger_account_id = ledger, updated_at = CURRENT_TIMESTAMP
       WHERE business_id = r.business_id
         AND ledger_account_id IS NULL
         AND ledger IS NOT NULL;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM bank_accounts
     WHERE ledger_account_id IS NOT NULL
     GROUP BY business_id, ledger_account_id
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_business_ledger
      ON bank_accounts (business_id, ledger_account_id)
      WHERE ledger_account_id IS NOT NULL;
  END IF;
END $$;
