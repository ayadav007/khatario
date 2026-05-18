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
    console.log('🔄 Adding shipping location columns...');
    
    await client.query('BEGIN');

    // Add shipping city, state, pincode columns
    console.log('📦 Adding shipping_city, shipping_state, shipping_pincode...');
    await client.query(`
      ALTER TABLE customers 
      ADD COLUMN IF NOT EXISTS shipping_city VARCHAR(100),
      ADD COLUMN IF NOT EXISTS shipping_state VARCHAR(100),
      ADD COLUMN IF NOT EXISTS shipping_pincode VARCHAR(10);
    `);

    // Migrate existing city/state/pincode to shipping if shipping is null (for existing records)
    await client.query(`
      UPDATE customers 
      SET shipping_city = city,
          shipping_state = state,
          shipping_pincode = pincode
      WHERE shipping_city IS NULL AND city IS NOT NULL;
    `);

    await client.query('COMMIT');
    console.log('✅ Migration completed successfully!');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
