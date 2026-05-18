const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/khatario'
});

async function checkInvoices() {
  try {
    // Check total invoices
    const totalResult = await pool.query('SELECT COUNT(*) as count FROM invoices');
    console.log(`\n📊 Total invoices in database: ${totalResult.rows[0].count}`);

    // Check invoices by branch
    const byBranchResult = await pool.query(`
      SELECT 
        COALESCE(b.name, 'No Branch') as branch_name,
        i.branch_id,
        COUNT(*) as count
      FROM invoices i
      LEFT JOIN branches b ON i.branch_id = b.id
      GROUP BY i.branch_id, b.name
      ORDER BY count DESC
    `);

    console.log('\n📍 Invoices by branch:');
    byBranchResult.rows.forEach(row => {
      console.log(`  - ${row.branch_name}: ${row.count} invoices (branch_id: ${row.branch_id || 'NULL'})`);
    });

    // Check invoices by status
    const byStatusResult = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM invoices
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log('\n📋 Invoices by status:');
    byStatusResult.rows.forEach(row => {
      console.log(`  - ${row.status}: ${row.count} invoices`);
    });

    // Check recent invoices
    const recentResult = await pool.query(`
      SELECT 
        i.invoice_number,
        i.status,
        i.branch_id,
        b.name as branch_name,
        i.created_at
      FROM invoices i
      LEFT JOIN branches b ON i.branch_id = b.id
      ORDER BY i.created_at DESC
      LIMIT 5
    `);

    console.log('\n🕐 Recent invoices:');
    recentResult.rows.forEach(row => {
      console.log(`  - ${row.invoice_number} | Status: ${row.status} | Branch: ${row.branch_name || 'No Branch'} | Created: ${row.created_at}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkInvoices();
