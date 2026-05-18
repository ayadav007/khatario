const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

// Database connection config
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'khatario',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('🔄 Recreating WhatsApp tables...');
    
    const sqlPath = path.join(__dirname, '..', 'database', 'recreate_whatsapp.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    await client.query(sql);
    
    console.log('✅ WhatsApp tables recreated successfully!');
  } catch (err) {
    console.error('❌ Error recreating tables:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
