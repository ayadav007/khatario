-- Purchase order file attachments + user comments (Zoho-style)

-- Allow purchase_order on unified document_attachments
ALTER TABLE document_attachments
  DROP CONSTRAINT IF EXISTS document_attachments_entity_type_check;

ALTER TABLE document_attachments
  ADD CONSTRAINT document_attachments_entity_type_check
  CHECK (entity_type IN (
    'invoice', 'purchase', 'credit_note', 'purchase_return',
    'journal_entry', 'expense', 'customer', 'supplier', 'purchase_order'
  ));

-- Manual comments on any entity (starting with purchase orders)
CREATE TABLE IF NOT EXISTS entity_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    comment_text TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entity_comments_entity
  ON entity_comments(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_comments_business
  ON entity_comments(business_id, created_at DESC);

COMMENT ON TABLE entity_comments IS 'User comments on business entities (purchase orders, etc.)';
