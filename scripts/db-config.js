/**
 * DB connection for migration scripts (not the Next.js app runtime).
 * Uses MIGRATION_DATABASE_URL when set; never reuses app DATABASE_URL automatically.
 */

function loadEnvFiles() {
  const path = require('path');
  const root = path.join(__dirname, '..');
  for (const file of ['.env', '.env.production', '.env.local']) {
    require('dotenv').config({ path: path.join(root, file) });
  }
}

function getMigrationDbConfig() {
  const migrationUrl =
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL_MIGRATE;

  if (migrationUrl) {
    return { connectionString: migrationUrl };
  }

  const appUser = process.env.DB_USER || process.env.POSTGRES_USER || 'postgres';
  const user = process.env.MIGRATION_DB_USER || appUser;

  return {
    host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432', 10),
    database:
      process.env.DB_NAME ||
      process.env.POSTGRES_DB ||
      process.env.POSTGRES_DATABASE ||
      'khatario',
    user,
    password: String(
      process.env.MIGRATION_DB_PASSWORD ??
        (user === appUser
          ? (process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? '')
          : (process.env.POSTGRES_PASSWORD ?? process.env.DB_PASSWORD ?? ''))
    ),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

function describeMigrationDb(config) {
  if (config.connectionString) {
    try {
      const u = new URL(config.connectionString);
      return `postgresql://${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`;
    } catch {
      return 'MIGRATION_DATABASE_URL (connection string)';
    }
  }
  return `${config.user}@${config.host}:${config.port}/${config.database}`;
}

function isLikelyAppOnlyDbUser(config) {
  const user =
    config.connectionString
      ? (() => {
          try {
            return new URL(config.connectionString).username;
          } catch {
            return '';
          }
        })()
      : config.user;
  return user && user !== 'postgres' && !process.env.MIGRATION_DATABASE_URL;
}

module.exports = {
  loadEnvFiles,
  getMigrationDbConfig,
  describeMigrationDb,
  isLikelyAppOnlyDbUser,
};
