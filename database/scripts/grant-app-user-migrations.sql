-- Grant khatario_user enough rights to run app migrations (alternative to MIGRATION_DATABASE_URL).
-- Run once as postgres: sudo -u postgres psql -d khatario -f database/scripts/grant-app-user-migrations.sql

GRANT ALL ON SCHEMA public TO khatario_user;
GRANT CREATE ON SCHEMA public TO khatario_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO khatario_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO khatario_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO khatario_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO khatario_user;
