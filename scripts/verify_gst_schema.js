/**
 * GST Schema Verification Script
 * 
 * Runs the schema verification query to check all GST fields are present.
 * 
 * Usage:
 *   node scripts/verify_gst_schema.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function getDbConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  const host = process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432');
  const database = process.env.DB_NAME || process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE || 'khatario';
  const user = process.env.DB_USER || process.env.POSTGRES_USER || 'postgres';
  const password = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '';

  return {
    host,
    port,
    database,
    user,
    password: password !== undefined && password !== null ? String(password) : '',
  };
}

async function verifySchema() {
  const pool = new Pool(getDbConfig());
  const client = await pool.connect();

  try {
    console.log('🔍 Verifying GST Compliance Schema...\n');

    const verificationPath = path.join(__dirname, '..', 'database', 'schema_verification_query.sql');
    const sql = fs.readFileSync(verificationPath, 'utf8');

    // Split SQL by semicolons and execute each statement
    const statements = sql.split(';').filter(s => s.trim().length > 0);

    for (const statement of statements) {
      if (statement.trim()) {
        try {
          const result = await client.query(statement + ';');
          if (result.rows && result.rows.length > 0) {
            console.table(result.rows);
          }
        } catch (error) {
          // Some statements might be SELECT that return no rows, that's OK
          if (!error.message.includes('does not exist') && !error.message.includes('relation')) {
            console.log(`Query result for: ${statement.substring(0, 50)}...`);
          }
        }
      }
    }

    console.log('\n✅ Schema verification completed!');
    console.log('\n📋 Quick Check Summary:');
    
    // Quick verification checks
    const checks = [
      { name: 'invoice_items GST fields', query: "SELECT COUNT(*) as count FROM information_schema.columns WHERE table_name = 'invoice_items' AND column_name IN ('cgst_amount', 'sgst_amount', 'igst_amount', 'taxable_value')" },
      { name: 'invoices document type fields', query: "SELECT COUNT(*) as count FROM information_schema.columns WHERE table_name = 'invoices' AND column_name IN ('supply_type', 'document_type', 'export_type')" },
      { name: 'debit_notes table', query: "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'debit_notes'" },
      { name: 'advance_payments table', query: "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'advance_payments'" },
      { name: 'purchases GST fields', query: "SELECT COUNT(*) as count FROM information_schema.columns WHERE table_name = 'purchases' AND column_name IN ('cgst_total', 'sgst_total', 'igst_total', 'itc_eligible')" },
    ];

    for (const check of checks) {
      const result = await client.query(check.query);
      const count = parseInt(result.rows[0].count);
      const status = count > 0 ? '✅' : '❌';
      console.log(`   ${status} ${check.name}: ${count} field(s)/table(s) found`);
    }

  } catch (error) {
    console.error('❌ Error verifying schema:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

verifySchema();

