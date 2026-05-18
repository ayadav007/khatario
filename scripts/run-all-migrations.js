const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function runAllMigrations() {
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
    console.log('Connected successfully!\n');

    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/^(\d+)/)?.[1] ?? '9999');
        const numB = parseInt(b.match(/^(\d+)/)?.[1] ?? '9999');
        if (numA !== numB) return numA - numB;
        return a.localeCompare(b);
      });

    console.log(`Found ${files.length} migration files.\n`);

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      try {
        await pool.query(sql);
        success++;
        console.log(`  ✅ ${file}`);
      } catch (err) {
        const msg = err.message || '';
        const isHarmless = msg.includes('already exists')
          || msg.includes('duplicate key')
          || msg.includes('does not exist') && msg.includes('DROP');
        if (isHarmless) {
          skipped++;
          console.log(`  ⏭️  ${file} (skipped: ${msg.split('\n')[0]})`);
        } else {
          failed++;
          console.error(`  ❌ ${file}: ${msg.split('\n')[0]}`);
        }
      }
    }

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`Migration Summary:`);
    console.log(`  ✅ Success: ${success}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  ❌ Failed:  ${failed}`);
    console.log(`  Total:     ${files.length}`);
    console.log(`${'═'.repeat(50)}\n`);

    if (failed > 0) {
      console.log('Some migrations failed. Review the errors above.');
    } else {
      console.log('All migrations applied successfully!');
    }
  } catch (error) {
    console.error('❌ Migration run failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runAllMigrations();
