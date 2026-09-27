-- Credit and debit notes can be cancelled (reversed), not deleted: the number stays in the
-- series and is reported as cancelled in GSTR-1 Table 13.
ALTER TABLE credit_notes
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE debit_notes
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_status_check;
ALTER TABLE credit_notes ADD CONSTRAINT credit_notes_status_check CHECK (status IN ('active', 'cancelled'));
ALTER TABLE debit_notes DROP CONSTRAINT IF EXISTS debit_notes_status_check;
ALTER TABLE debit_notes ADD CONSTRAINT debit_notes_status_check CHECK (status IN ('active', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice_status ON credit_notes (invoice_id, status);
CREATE INDEX IF NOT EXISTS idx_debit_notes_invoice_status ON debit_notes (invoice_id, status);
