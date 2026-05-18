-- Migration 215: Soft-delete timestamps for items/suppliers (customers: future)
-- Scope: ONLY adds deleted_at + indexes. No behavior changes here.
-- Created: 2026-04-29

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

-- Customers: column-only (future soft delete; do not change reads/behavior yet)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

-- Indexes for fast filtering in list/search APIs
CREATE INDEX IF NOT EXISTS idx_items_business_deleted_at
  ON items(business_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_suppliers_business_deleted_at
  ON suppliers(business_id, deleted_at);

