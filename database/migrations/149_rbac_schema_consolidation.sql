-- Migration 149: RBAC Schema Consolidation
--
-- BACKGROUND: The codebase has two overlapping RBAC schemas:
--   1. Migration 019: user_roles, permission_modules, role_permissions (module_key + boolean columns)
--   2. Migration 059: permission_modules, permissions, role_permissions (permission_id FK)
--
-- The application actually uses schema 019 (module_key + can_view/can_add/can_modify/can_delete).
-- Schema 059 tables (permissions, role_permissions with permission_id) were created but never populated or queried.
--
-- This migration cleans up the unused 059 artifacts.

-- Drop 059's `permissions` table if it has zero rows (safety check).
-- The 059 role_permissions table was never created separately because CREATE TABLE IF NOT EXISTS
-- saw the 019 table and skipped it. So only the `permissions` table from 059 needs cleanup.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'permissions') THEN
    IF (SELECT COUNT(*) FROM permissions) = 0 THEN
      DROP TABLE permissions CASCADE;
      RAISE NOTICE 'Dropped unused 059 permissions table (0 rows).';
    ELSE
      RAISE NOTICE 'permissions table has data — skipping drop. Manual review needed.';
    END IF;
  END IF;
END $$;

-- Add display_order to role_permissions if missing (some environments may not have it from 019)
ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Ensure field_permissions has proper defaults documented
COMMENT ON TABLE field_permissions IS 'Field-level permissions: when no row exists for a field, view is ALLOWED and edit is DENIED (fail-closed for writes).';
COMMENT ON TABLE role_permissions IS 'Module-level RBAC permissions using boolean columns (can_view, can_add, can_modify, can_delete). Schema from migration 019.';
COMMENT ON TABLE permission_modules IS 'Registry of permission modules. Each module_key maps to a resource type (invoices, customers, etc.).';
