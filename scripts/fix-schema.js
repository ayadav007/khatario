const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function runFixes() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'khatario',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  try {
    console.log('Connecting to database...');
    await pool.query('SELECT NOW()');
    console.log('Connected successfully!');

    console.log('Reading fix script...');
    const fixPath = path.join(__dirname, '..', 'database', 'fix_critical_issues.sql');
    const fixSQL = fs.readFileSync(fixPath, 'utf8');

    console.log('Applying fixes...');
    await pool.query(fixSQL);
    console.log('✅ Database fixes applied successfully!');

    console.log('\nFixes applied! Your database schema is now updated.');
  } catch (error) {
    console.error('❌ Fix application failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runFixes();

