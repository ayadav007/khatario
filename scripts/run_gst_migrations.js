/**
 * GST Compliance Migrations Runner
 * 
 * This script runs all GST compliance migrations in order.
 * 
 * Usage:
 *   node scripts/run_gst_migrations.js
 * 
 * Environment variables required:
 *   - DATABASE_URL or DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Get database connection from environment
function getDbConfig() {
  // Try DATABASE_URL first
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL
    };
  }

  // Get individual connection parameters
  const host = process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432');
  const database = process.env.DB_NAME || process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE || 'khatario';
  const user = process.env.DB_USER || process.env.POSTGRES_USER || 'postgres';
  const password = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '';

  const config = {
    host,
    port,
    database,
    user,
  };

  // Password must be a string (even if empty)
  // PostgreSQL SCRAM authentication requires string type
  if (password !== undefined && password !== null) {
    config.password = String(password);
  } else {
    // If password is truly missing, use empty string
    config.password = '';
  }

  return config;
}

const migrations = [
  '001_phase1_invoice_items_gst_breakdown.sql',
  '002_phase1_invoice_document_type.sql',
  '003_phase1_customer_supplier_state_code.sql',
  '004_phase1_credit_notes_gst_fields.sql',
  '005_phase1_debit_notes_table.sql',
  '006_phase2_purchases_gst_fields.sql',
  '007_phase2_purchase_items_gst_breakdown.sql',
  '008_phase3_advance_payments_table.sql',
  '009_phase3_itc_reversals_table.sql',
  '010_hsn_sac_master_table.sql',
  '042_add_item_type_to_items.sql',
  '043_add_itc_type_to_purchase_items.sql',
  '044_gstr2b_reconciliation_schema.sql',
];

async function runMigrations() {
  const dbConfig = getDbConfig();
  
  // Validate configuration
  if (!dbConfig.connectionString && !dbConfig.database) {
    console.error('❌ ERROR: Database configuration missing!');
    console.error('   Please set DATABASE_URL or DB_NAME in .env file');
    process.exit(1);
  }

  console.log('🚀 Starting GST Compliance Migrations...\n');
  console.log(`📊 Database Config:`);
  if (dbConfig.connectionString) {
    console.log(`   Using DATABASE_URL`);
  } else {
    console.log(`   Host: ${dbConfig.host}`);
    console.log(`   Port: ${dbConfig.port}`);
    console.log(`   Database: ${dbConfig.database}`);
    console.log(`   User: ${dbConfig.user}`);
    console.log(`   Password: ${dbConfig.password ? '***' : '(not set)'}`);
  }
  console.log('');

  const pool = new Pool(dbConfig);
  let client;
  
  try {
    client = await pool.connect();
    console.log(`✅ Connected to database: ${client.database || dbConfig.database}\n`);

    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS gst_migrations_log (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        success BOOLEAN DEFAULT true,
        error_message TEXT
      )
    `);

    let successCount = 0;
    let failCount = 0;

    for (const migrationFile of migrations) {
      const migrationPath = path.join(__dirname, '..', 'database', 'migrations', migrationFile);
      
      if (!fs.existsSync(migrationPath)) {
        console.log(`⚠️  Migration file not found: ${migrationFile}`);
        failCount++;
        continue;
      }

      const sql = fs.readFileSync(migrationPath, 'utf8');
      
      try {
        console.log(`📝 Running: ${migrationFile}...`);
        
        // Execute migration
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');

        // Log successful migration
        await client.query(`
          INSERT INTO gst_migrations_log (migration_name, success)
          VALUES ($1, true)
          ON CONFLICT (migration_name) 
          DO UPDATE SET executed_at = CURRENT_TIMESTAMP, success = true, error_message = NULL
        `, [migrationFile]);

        console.log(`✅ Success: ${migrationFile}\n`);
        successCount++;
      } catch (error) {
        await client.query('ROLLBACK');
        
        // Log failed migration
        await client.query(`
          INSERT INTO gst_migrations_log (migration_name, success, error_message)
          VALUES ($1, false, $2)
          ON CONFLICT (migration_name) 
          DO UPDATE SET executed_at = CURRENT_TIMESTAMP, success = false, error_message = $2
        `, [migrationFile, error.message]);

        console.error(`❌ Failed: ${migrationFile}`);
        console.error(`   Error: ${error.message}\n`);
        failCount++;
        
        // Ask user if they want to continue
        // For now, we'll continue with other migrations
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log('='.repeat(60) + '\n');

    if (failCount === 0) {
      console.log('🎉 All migrations completed successfully!');
      console.log('\n📋 Next steps:');
      console.log('   1. Run schema verification query to verify all fields');
      console.log('   2. Test invoice creation with GST breakdown');
      console.log('   3. Review backfilled data in existing records\n');
    } else {
      console.log('⚠️  Some migrations failed. Please review the errors above.');
      console.log('💡 Tip: Check gst_migrations_log table for details.\n');
    }

  } catch (error) {
    console.error('💥 Fatal error:', error.message);
    if (error.message.includes('password')) {
      console.error('\n💡 Tip: Check your .env file has correct DB_PASSWORD or DATABASE_URL');
    }
    if (error.message.includes('connection')) {
      console.error('\n💡 Tip: Verify PostgreSQL is running and connection details are correct');
    }
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

// Check if migrations have already been run
async function checkMigrationStatus() {
  const pool = new Pool(getDbConfig());
  const client = await pool.connect();

  try {
    // Check if migrations log table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'gst_migrations_log'
      )
    `);

    if (tableExists.rows[0].exists) {
      const executed = await client.query(`
        SELECT migration_name, success, executed_at, error_message
        FROM gst_migrations_log
        ORDER BY executed_at
      `);

      if (executed.rows.length > 0) {
        console.log('\n📜 Previously Executed Migrations:');
        console.log('='.repeat(60));
        executed.rows.forEach(row => {
          const status = row.success ? '✅' : '❌';
          const date = new Date(row.executed_at).toLocaleString();
          console.log(`${status} ${row.migration_name} (${date})`);
          if (!row.success && row.error_message) {
            console.log(`   Error: ${row.error_message}`);
          }
        });
        console.log('='.repeat(60) + '\n');
      }
    }
  } catch (error) {
    // Table doesn't exist yet, that's fine
  } finally {
    client.release();
    await pool.end();
  }
}

// Main execution
(async () => {
  await checkMigrationStatus();
  await runMigrations();
})();

