-- Migration 239: Business custom fields for items and invoices

CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('item', 'invoice')),
  field_key VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  field_type VARCHAR(20) NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text', 'number', 'date', 'dropdown')),
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_custom_field_definitions_business_entity_key
    UNIQUE (business_id, entity_type, field_key)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_business_entity
  ON custom_field_definitions (business_id, entity_type, sort_order);

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON TABLE custom_field_definitions IS 'User-defined fields for items and invoice metadata';
COMMENT ON COLUMN items.custom_fields IS 'Values keyed by custom_field_definitions.field_key';
COMMENT ON COLUMN invoices.custom_fields IS 'Per-invoice values for invoice entity custom fields';
