const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'khatario',
  user: 'postgres',
  password: ''
});

async function checkInvoices() {
  try {
    const result = await pool.query(`
      SELECT 
        i.invoice_number, 
        i.branch_id, 
        i.status,
        b.name as branch_name
      FROM invoices i
      LEFT JOIN branches b ON i.branch_id = b.id
      WHERE i.business_id = '6acc7e1c-30aa-4b4b-bf84-1b944cf80bb6'
      ORDER BY i.created_at DESC
    `);
    
    console.log('\n📊 Total invoices in database:', result.rows.length);
    console.log('\n📋 Invoice details:');
    result.rows.forEach(row => {
      console.log(`  - ${row.invoice_number} | Branch: ${row.branch_name || 'NULL'} (${row.branch_id || 'NULL'}) | Status: ${row.status}`);
    });

    // Check branch counts
    const branchCount = await pool.query(`
      SELECT 
        COALESCE(b.name, 'No Branch') as branch_name,
        i.branch_id,
        COUNT(*) as count
      FROM invoices i
      LEFT JOIN branches b ON i.branch_id = b.id
      WHERE i.business_id = '6acc7e1c-30aa-4b4b-bf84-1b944cf80bb6'
      GROUP BY i.branch_id, b.name
    `);

    console.log('\n📍 Invoices per branch:');
    branchCount.rows.forEach(row => {
      console.log(`  - ${row.branch_name}: ${row.count} invoices`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkInvoices();
