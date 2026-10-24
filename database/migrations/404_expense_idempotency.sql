-- One create request, one expense. Retries with the same key return the original row.
-- NULL keys stay allowed so expenses posted before this column are left unchanged.
-- Historical ledger lines are not updated.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS expenses_business_idempotency_key
  ON expenses (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
