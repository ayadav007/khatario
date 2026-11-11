-- Row Level Security audit: run against each environment.
-- Read-only. On the VPS, run once per database:
--   sudo -u postgres psql -d khatario      -f database/scripts/check-rls.sql   # staging
--   sudo -u postgres psql -d khatario_prod -f database/scripts/check-rls.sql   # production

\echo '=== Tables with RLS enabled/forced (public schema) ==='
SELECT relname AS table_name, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND (relrowsecurity OR relforcerowsecurity)
ORDER BY relname;

\echo '=== Summary ==='
SELECT count(*) FILTER (WHERE relrowsecurity) AS tables_with_rls,
       count(*) AS total_tables
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p');

\echo '=== RLS policies defined ==='
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies ORDER BY tablename, policyname;

\echo '=== Does the app role bypass RLS? ==='
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
WHERE rolname IN ('postgres', 'khatario_user') OR rolname = current_user;
