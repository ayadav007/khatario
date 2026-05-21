const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { loadEnvFiles, getMigrationDbConfig, describeMigrationDb } = require('./db-config');

function getDbConfig() {
  return getMigrationDbConfig();
}

loadEnvFiles();

async function runMigration(migrationFile) {
  const dbConfig = getDbConfig();

  if (!dbConfig.connectionString && !dbConfig.database) {
    console.error('❌ Database configuration missing.');
    console.error('   Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in .env or .env.production');
    process.exit(1);
  }

  const pool = new Pool(dbConfig);

  try {
    console.log('Connecting to database...');
    console.log(`Migration DB: ${describeMigrationDb(dbConfig)}`);
    await pool.query('SELECT NOW()');
    console.log('Connected successfully!');

    const migrationPath = path.join(__dirname, '..', migrationFile);
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    console.log(`Reading migration file: ${migrationFile}...`);
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration...');
    await pool.query(migrationSQL);
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error('Usage: node scripts/run-migration.js <migration-file-path>');
  console.error('Example: node scripts/run-migration.js database/migrations/239_custom_fields.sql');
  process.exit(1);
}

runMigration(migrationFile);
