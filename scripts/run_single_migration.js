const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function getDbConfig() {
  // Try DATABASE_URL first
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL
    };
  }

  // Fall back to individual variables
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'khatario',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  };

  return config;
}

async function runMigration(migrationFile) {
  const dbConfig = getDbConfig();
  
  if (!dbConfig.connectionString && !dbConfig.database) {
    console.error('❌ ERROR: Database configuration missing!');
    console.error('   Please set DATABASE_URL or DB_NAME in .env file');
    process.exit(1);
  }

  console.log('🚀 Running migration:', migrationFile);
  console.log(`📊 Database: ${dbConfig.database || 'from DATABASE_URL'}\n`);

  const pool = new Pool(dbConfig);
  let client;
  
  try {
    client = await pool.connect();
    console.log('✅ Connected to database\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'database', 'migrations', migrationFile);
    
    if (!fs.existsSync(migrationPath)) {
      console.error(`❌ Migration file not found: ${migrationPath}`);
      process.exit(1);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📝 Executing migration...');
    await client.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('   Error details:', error);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// Get migration file from command line argument
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('❌ ERROR: Migration file name required!');
  console.error('   Usage: node scripts/run_single_migration.js <migration_file.sql>');
  console.error('   Example: node scripts/run_single_migration.js 078_inventory_adjustments.sql');
  process.exit(1);
}

runMigration(migrationFile);
