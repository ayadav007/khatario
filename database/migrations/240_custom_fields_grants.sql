-- Migration 240: Grant app roles access to custom_field_definitions
-- Run as postgres/superuser if migration 239 was applied without table grants.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'items'
      AND privilege_type = 'SELECT'
      AND grantee NOT IN ('PUBLIC')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE custom_field_definitions TO %I',
      r.grantee
    );
    RAISE NOTICE 'Granted custom_field_definitions to %', r.grantee;
  END LOOP;
END $$;

-- Fallback: if no grants were copied from items, allow all DB roles (typical single-app VPS).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE custom_field_definitions TO PUBLIC;
