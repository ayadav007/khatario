const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnvFiles() {
  const root = path.join(__dirname, '..');
  const files = ['.env', '.env.production', '.env.local'];
  for (const file of files) {
    require('dotenv').config({ path: path.join(root, file) });
  }
}

function getDbConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  const password = process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? '';

  return {
    host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432', 10),
    database:
      process.env.DB_NAME ||
      process.env.POSTGRES_DB ||
      process.env.POSTGRES_DATABASE ||
      'khatario',
    user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
    password: String(password),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
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
    if (dbConfig.connectionString) {
      console.log('Using DATABASE_URL');
    } else {
      console.log(`Host: ${dbConfig.host}, DB: ${dbConfig.database}, User: ${dbConfig.user}`);
    }
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
