-- Remembers the posting that an expense idempotency key created.
-- Existing keys keep a null hash and stay valid. Ledger lines are not rewritten.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS idempotency_payload_hash VARCHAR(64);
