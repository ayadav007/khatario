const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'khatario',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('🔄 Starting address columns migration...');
    
    await client.query('BEGIN');

    // 1. Update Customers Table
    console.log('📦 Updating customers table...');
    await client.query(`
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS billing_address TEXT,
      ADD COLUMN IF NOT EXISTS shipping_address TEXT;
    `);

    // Migrate existing address to billing_address if billing_address is null
    await client.query(`
      UPDATE customers 
      SET billing_address = address, shipping_address = address 
      WHERE billing_address IS NULL AND address IS NOT NULL;
    `);

    // 2. Update Invoices Table (for snapshotting)
    console.log('📄 Updating invoices table...');
    await client.query(`
      ALTER TABLE invoices 
      ADD COLUMN IF NOT EXISTS billing_address TEXT,
      ADD COLUMN IF NOT EXISTS shipping_address TEXT;
    `);

    // Backfill invoice addresses from customers
    await client.query(`
      UPDATE invoices i
      SET billing_address = c.address,
          shipping_address = c.address
      FROM customers c
      WHERE i.customer_id = c.id
      AND i.billing_address IS NULL;
    `);

    await client.query('COMMIT');
    console.log('✅ Migration completed successfully!');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
