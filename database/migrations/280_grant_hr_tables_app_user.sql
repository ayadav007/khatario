-- Migration 280: Grant app DB roles access to newer tables created as postgres
-- Symptom: "permission denied for table shift_roster_entries" / "hr_announcements"
-- Cause: MIGRATION_DATABASE_URL creates tables as postgres without GRANT to khatario_user.

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Copy table privileges from a known working table (employees) onto every public table.
  FOR r IN
    SELECT DISTINCT grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'employees'
      AND privilege_type = 'SELECT'
      AND grantee NOT IN ('PUBLIC')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
      r.grantee
    );
    EXECUTE format(
      'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I',
      r.grantee
    );
    RAISE NOTICE 'Granted ALL TABLES/SEQUENCES in public to %', r.grantee;
  END LOOP;

  -- Fallback for typical single-app VPS
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO PUBLIC;
  GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khatario_user') THEN
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO khatario_user;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO khatario_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO khatario_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO khatario_user;
  END IF;
END $$;
