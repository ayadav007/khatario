-- Migration 210: Soft delete support for core transactions (restore-ready)
-- Description: Nullable deleted_at timestamps; callers should prefer UPDATE ... SET deleted_at = CURRENT_TIMESTAMP instead of DELETE
-- Created: 2026-04-28

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

COMMENT ON COLUMN invoices.deleted_at IS 'When set, invoice is soft-deleted; exclude with WHERE deleted_at IS NULL.';
COMMENT ON COLUMN purchases.deleted_at IS 'When set, purchase is soft-deleted; exclude with WHERE deleted_at IS NULL.';
COMMENT ON COLUMN payments.deleted_at IS 'When set, payment is soft-deleted; exclude with WHERE deleted_at IS NULL.';
COMMENT ON COLUMN customers.deleted_at IS 'When set, customer is soft-deleted; exclude with WHERE deleted_at IS NULL.';

-- Developer note (single-line comments only: block comments break if text contains Glob-style '**/' paths)
-- AFFECTED AREAS — add AND deleted_at IS NULL where these tables are queried as live operational data:
--   invoices, purchases, payments, customers (FROM/JOIN).
-- HIGH-TRAFFIC: app/api/invoices, payments, purchases, dashboard, customers, reports, search, badges, backup, admin
-- LIB: lib/gst, lib/reports/stockSummaryDashboard.ts, lib/ledger-utils.ts, reminder handlers, provisions-manager
-- Soft-delete behaviour: UPDATE deleted_at, not DELETE; purges may still hard-delete; partial unique indexes may follow.
