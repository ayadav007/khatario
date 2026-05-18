/**
 * Diagnostic script to check why reports show "No Data Available"
 * 
 * This script checks:
 * 1. Total invoices in the database
 * 2. Invoices by status (draft, final, cancelled)
 * 3. Invoices by document_type (proforma vs regular)
 * 4. Invoices in the selected date range
 * 5. Final invoices (eligible for reports) in the date range
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

// Get database config (same as lib/db.ts)
function getDbConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'khatario',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

const pool = new Pool(getDbConfig());

async function diagnoseNoData(businessId, fromDate, toDate) {
  const client = await pool.connect();
  
  try {
    console.log('\n🔍 DIAGNOSING "NO DATA AVAILABLE" ISSUE\n');
    console.log(`Business ID: ${businessId}`);
    console.log(`Date Range: ${fromDate} to ${toDate}\n`);
    console.log('='.repeat(60));

    // 1. Total invoices count
    const totalInvoices = await client.query(
      `SELECT COUNT(*) as count FROM invoices WHERE business_id = $1`,
      [businessId]
    );
    console.log(`\n1️⃣  Total Invoices: ${totalInvoices.rows[0].count}`);

    // 2. Invoices by status
    const byStatus = await client.query(
      `SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(grand_total), 0) as total_amount
      FROM invoices 
      WHERE business_id = $1
      GROUP BY status
      ORDER BY count DESC`,
      [businessId]
    );
    console.log(`\n2️⃣  Invoices by Status:`);
    byStatus.rows.forEach(row => {
      console.log(`   - ${row.status || 'NULL'}: ${row.count} invoices (₹${parseFloat(row.total_amount).toLocaleString('en-IN')})`);
    });

    // 3. Invoices by document_type
    const byDocType = await client.query(
      `SELECT 
        COALESCE(document_type, 'regular') as doc_type,
        COUNT(*) as count
      FROM invoices 
      WHERE business_id = $1
      GROUP BY document_type
      ORDER BY count DESC`,
      [businessId]
    );
    console.log(`\n3️⃣  Invoices by Document Type:`);
    byDocType.rows.forEach(row => {
      console.log(`   - ${row.doc_type}: ${row.count} invoices`);
    });

    // 4. Invoices in date range (any status)
    const inDateRange = await client.query(
      `SELECT 
        COUNT(*) as count,
        COALESCE(SUM(grand_total), 0) as total_amount
      FROM invoices 
      WHERE business_id = $1 
        AND invoice_date >= $2 
        AND invoice_date <= $3`,
      [businessId, fromDate, toDate]
    );
    console.log(`\n4️⃣  Invoices in Date Range (Any Status):`);
    console.log(`   - Count: ${inDateRange.rows[0].count}`);
    console.log(`   - Total Amount: ₹${parseFloat(inDateRange.rows[0].total_amount).toLocaleString('en-IN')}`);

    // 5. Final invoices in date range (excluding proforma)
    const eligibleInvoices = await client.query(
      `SELECT 
        COUNT(*) as count,
        COALESCE(SUM(grand_total), 0) as total_sales,
        COALESCE(SUM(paid_amount), 0) as total_collected,
        COALESCE(SUM(balance_amount), 0) as total_pending,
        COALESCE(SUM(tax_total), 0) as total_tax
      FROM invoices 
      WHERE business_id = $1 
        AND invoice_date >= $2 
        AND invoice_date <= $3
        AND status = 'final'
        AND (document_type IS NULL OR document_type != 'proforma_invoice')`,
      [businessId, fromDate, toDate]
    );
    console.log(`\n5️⃣  Eligible Invoices for Reports (Final, Non-Proforma):`);
    console.log(`   - Count: ${eligibleInvoices.rows[0].count}`);
    console.log(`   - Total Sales: ₹${parseFloat(eligibleInvoices.rows[0].total_sales).toLocaleString('en-IN')}`);
    console.log(`   - Total Collected: ₹${parseFloat(eligibleInvoices.rows[0].total_collected).toLocaleString('en-IN')}`);
    console.log(`   - Total Pending: ₹${parseFloat(eligibleInvoices.rows[0].total_pending).toLocaleString('en-IN')}`);
    console.log(`   - Total Tax: ₹${parseFloat(eligibleInvoices.rows[0].total_tax).toLocaleString('en-IN')}`);

    // 6. Date range of all invoices
    const dateRange = await client.query(
      `SELECT 
        MIN(invoice_date) as earliest_date,
        MAX(invoice_date) as latest_date
      FROM invoices 
      WHERE business_id = $1`,
      [businessId]
    );
    console.log(`\n6️⃣  Invoice Date Range in Database:`);
    if (dateRange.rows[0].earliest_date) {
      console.log(`   - Earliest Invoice: ${dateRange.rows[0].earliest_date}`);
      console.log(`   - Latest Invoice: ${dateRange.rows[0].latest_date}`);
    } else {
      console.log(`   - No invoices found in database`);
    }

    // 7. Draft invoices in date range
    const draftInvoices = await client.query(
      `SELECT COUNT(*) as count 
      FROM invoices 
      WHERE business_id = $1 
        AND invoice_date >= $2 
        AND invoice_date <= $3
        AND status = 'draft'`,
      [businessId, fromDate, toDate]
    );
    console.log(`\n7️⃣  Draft Invoices in Date Range: ${draftInvoices.rows[0].count}`);
    if (parseInt(draftInvoices.rows[0].count) > 0) {
      console.log(`   ⚠️  You have ${draftInvoices.rows[0].count} draft invoice(s) that need to be finalized!`);
    }

    // 8. Proforma invoices in date range
    const proformaInvoices = await client.query(
      `SELECT COUNT(*) as count 
      FROM invoices 
      WHERE business_id = $1 
        AND invoice_date >= $2 
        AND invoice_date <= $3
        AND document_type = 'proforma_invoice'`,
      [businessId, fromDate, toDate]
    );
    console.log(`\n8️⃣  Proforma Invoices in Date Range: ${proformaInvoices.rows[0].count}`);
    if (parseInt(proformaInvoices.rows[0].count) > 0) {
      console.log(`   ℹ️  Proforma invoices are not included in sales reports (as per GST rules)`);
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`\n📊 SUMMARY:\n`);
    
    if (parseInt(eligibleInvoices.rows[0].count) === 0) {
      console.log(`❌ No eligible invoices found for the report.`);
      console.log(`\nPossible reasons:`);
      
      if (parseInt(totalInvoices.rows[0].count) === 0) {
        console.log(`   1. No invoices exist in the database`);
      } else if (parseInt(inDateRange.rows[0].count) === 0) {
        console.log(`   2. No invoices exist in the selected date range (${fromDate} to ${toDate})`);
        if (dateRange.rows[0].earliest_date) {
          console.log(`      - Your invoices are from ${dateRange.rows[0].earliest_date} to ${dateRange.rows[0].latest_date}`);
          console.log(`      - Try adjusting the date range to match your invoice dates`);
        }
      } else if (parseInt(draftInvoices.rows[0].count) > 0) {
        console.log(`   3. You have ${draftInvoices.rows[0].count} draft invoice(s) in this date range`);
        console.log(`      - Draft invoices are not included in reports`);
        console.log(`      - Finalize them to include in reports`);
      } else {
        console.log(`   4. All invoices in this date range are either:`);
        console.log(`      - In 'draft' status (need to be finalized)`);
        console.log(`      - Proforma invoices (not included in sales reports)`);
        console.log(`      - Cancelled invoices (not included in reports)`);
      }
    } else {
      console.log(`✅ Found ${eligibleInvoices.rows[0].count} eligible invoice(s) for the report!`);
      console.log(`   - Total Sales: ₹${parseFloat(eligibleInvoices.rows[0].total_sales).toLocaleString('en-IN')}`);
    }
    
    console.log(`\n${'='.repeat(60)}\n`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Get command line arguments
const businessId = process.argv[2];
const fromDate = process.argv[3] || '2025-12-01';
const toDate = process.argv[4] || '2026-01-19';

if (!businessId) {
  console.error('Usage: node scripts/diagnose-no-data.js <business_id> [from_date] [to_date]');
  console.error('Example: node scripts/diagnose-no-data.js abc123 2025-12-01 2026-01-19');
  process.exit(1);
}

diagnoseNoData(businessId, fromDate, toDate).catch(console.error);
