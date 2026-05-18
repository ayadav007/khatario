-- Migration 074: Journal Entry Attachments Table
-- Creates table for storing attachments/supporting documents for journal entries

CREATE TABLE IF NOT EXISTS journal_entry_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_type VARCHAR(50), -- 'pdf', 'image', 'document', etc.
    file_size INTEGER, -- Size in bytes
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_journal_entry_attachments_journal_entry_id ON journal_entry_attachments(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_attachments_uploaded_by ON journal_entry_attachments(uploaded_by);

COMMENT ON TABLE journal_entry_attachments IS 'Attachments/supporting documents for journal entries';
COMMENT ON COLUMN journal_entry_attachments.file_url IS 'URL or path to the uploaded file';

