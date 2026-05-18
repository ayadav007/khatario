const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

async function checkColumns() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const res = await pool.query(`
      SELECT table_name, column_name, character_maximum_length
      FROM information_schema.columns 
      WHERE column_name IN ('from_number', 'to_number')
    `);
    console.log('Columns lengths:', res.rows);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

checkColumns();
