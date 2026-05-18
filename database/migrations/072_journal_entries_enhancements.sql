-- Migration 072: Journal Entries Table Enhancement
-- Creates journal_entries table to track journal entry metadata (locking, reversing, templates, etc.)
-- and migrates existing entries from ledger_entry_lines

-- Create journal_entries table
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    voucher_id UUID NOT NULL, -- Links to ledger_entry_lines.voucher_id
    voucher_number VARCHAR(100) NOT NULL,
    entry_date DATE NOT NULL,
    reference_number VARCHAR(100),
    narration TEXT,
    
    -- Locking fields
    is_locked BOOLEAN DEFAULT false,
    locked_at TIMESTAMP,
    locked_by UUID REFERENCES users(id),
    lock_reason TEXT,
    
    -- Reversing entry fields
    is_reversing BOOLEAN DEFAULT false,
    reverses_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
    reversal_date DATE, -- Date when this entry should be reversed (for scheduled reversals)
    
    -- Template fields
    template_id UUID, -- Will reference journal_entry_templates table (created in migration 073)
    
    -- Metadata fields
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    tags TEXT[],
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(business_id, voucher_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_journal_entries_business_id ON journal_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_voucher_id ON journal_entries(voucher_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_is_locked ON journal_entries(is_locked);
CREATE INDEX IF NOT EXISTS idx_journal_entries_is_reversing ON journal_entries(is_reversing);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reverses_entry_id ON journal_entries(reverses_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reversal_date ON journal_entries(reversal_date) WHERE reversal_date IS NOT NULL;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_journal_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_journal_entries_updated_at
    BEFORE UPDATE ON journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_journal_entries_updated_at();

-- Migrate existing journal entries from ledger_entry_lines
-- Group by voucher_id and create journal_entries records
-- Get voucher_number from ledger_entries table if available, otherwise generate
INSERT INTO journal_entries (
    business_id,
    voucher_id,
    voucher_number,
    entry_date,
    reference_number,
    narration,
    is_locked,
    created_at
)
SELECT DISTINCT
    lel.business_id,
    lel.voucher_id,
    COALESCE(
        (SELECT le.voucher_number FROM ledger_entries le 
         WHERE le.transaction_id = lel.voucher_id 
         AND le.transaction_type = 'journal' 
         AND le.business_id = lel.business_id 
         AND le.voucher_number IS NOT NULL
         LIMIT 1),
        generate_voucher_number(lel.business_id, 'journal', MAX(lel.entry_date))
    ) as voucher_number,
    MAX(lel.entry_date) as entry_date,
    MAX(lel.reference_number) FILTER (WHERE lel.reference_number IS NOT NULL) as reference_number,
    MAX(lel.narration) FILTER (WHERE lel.narration IS NOT NULL) as narration,
    false as is_locked,
    MIN(lel.created_at) as created_at
FROM ledger_entry_lines lel
WHERE lel.voucher_type = 'journal'
  AND NOT EXISTS (
      SELECT 1 FROM journal_entries je WHERE je.voucher_id = lel.voucher_id AND je.business_id = lel.business_id
  )
GROUP BY lel.business_id, lel.voucher_id
ON CONFLICT (business_id, voucher_id) DO NOTHING;

COMMENT ON TABLE journal_entries IS 'Journal entries metadata table for tracking locking, reversing, templates, and other features';
COMMENT ON COLUMN journal_entries.voucher_id IS 'Links to ledger_entry_lines.voucher_id for the actual entry lines';
COMMENT ON COLUMN journal_entries.is_locked IS 'If true, entry cannot be edited or deleted';
COMMENT ON COLUMN journal_entries.is_reversing IS 'If true, this is a reversing entry';
COMMENT ON COLUMN journal_entries.reverses_entry_id IS 'Reference to the journal entry this entry reverses';
COMMENT ON COLUMN journal_entries.reversal_date IS 'Date when this entry should be automatically reversed (for scheduled reversals)';

