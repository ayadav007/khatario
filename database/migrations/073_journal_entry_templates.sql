-- Migration 073: Journal Entry Templates Table
-- Creates table for storing reusable journal entry templates

CREATE TABLE IF NOT EXISTS journal_entry_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    entry_date_offset INTEGER DEFAULT 0, -- Days offset from current date (e.g., -1 for yesterday, 0 for today, 1 for tomorrow)
    lines JSONB NOT NULL, -- Array of template lines: [{"account_id": "uuid", "debit": 1000, "credit": 0, "narration": "..."}, ...]
    tags TEXT[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    
    UNIQUE(business_id, name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_journal_entry_templates_business_id ON journal_entry_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_templates_is_active ON journal_entry_templates(is_active);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_journal_entry_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_journal_entry_templates_updated_at
    BEFORE UPDATE ON journal_entry_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_journal_entry_templates_updated_at();

-- Add foreign key constraint for template_id in journal_entries (added after table creation)
ALTER TABLE journal_entries
ADD CONSTRAINT fk_journal_entries_template_id
FOREIGN KEY (template_id) REFERENCES journal_entry_templates(id) ON DELETE SET NULL;

COMMENT ON TABLE journal_entry_templates IS 'Reusable templates for creating journal entries';
COMMENT ON COLUMN journal_entry_templates.entry_date_offset IS 'Days offset from current date when using template (e.g., -1 for yesterday, 0 for today)';
COMMENT ON COLUMN journal_entry_templates.lines IS 'JSONB array of template lines with account_id, debit, credit, narration';

