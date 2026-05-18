/**
 * Diagnostic script to check why Profit & Loss report shows all zeros
 * 
 * Usage: node scripts/diagnose-profit-loss.js [business_id] [from_date] [to_date] [branch_id]
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'khatario',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || process.env.DATABASE_URL?.split('@')[0]?.split(':')[2] || '',
  connectionString: process.env.DATABASE_URL,
});

async function diagnose(businessId, fromDate, toDate, branchId) {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Diagnosing Profit & Loss Report...\n');
    console.log(`Business ID: ${businessId}`);
    console.log(`Date Range: ${fromDate} to ${toDate}`);
    console.log(`Branch ID: ${branchId || 'All branches'}\n`);

    // 1. Check if business exists
    const business = await client.query(
      'SELECT id, name FROM businesses WHERE id = $1',
      [businessId]
    );
    if (business.rows.length === 0) {
      console.log('❌ Business not found!');
      return;
    }
    console.log(`✅ Business found: ${business.rows[0].name}\n`);

    // 2. Check income accounts
    let incomeQuery = `
      SELECT COUNT(*) as count
      FROM accounts
      WHERE business_id = $1 AND account_type = 'income' AND is_active = true
    `;
    const incomeAccounts = await client.query(incomeQuery, [businessId]);
    console.log(`📊 Income Accounts: ${incomeAccounts.rows[0].count}`);

    if (parseInt(incomeAccounts.rows[0].count) === 0) {
      console.log('   ⚠️  No income accounts found! This is why income shows ₹0.00');
      console.log('   💡 Solution: Create income accounts (e.g., Sales, Other Income)');
    } else {
      // Show income accounts
      const incomeDetails = await client.query(`
        SELECT id, account_code, account_name, account_type
        FROM accounts
        WHERE business_id = $1 AND account_type = 'income' AND is_active = true
        ORDER BY account_code
        LIMIT 10
      `, [businessId]);
      console.log('   Income Accounts:');
      incomeDetails.rows.forEach(acc => {
        console.log(`     - ${acc.account_code}: ${acc.account_name}`);
      });
    }
    console.log('');

    // 3. Check expense accounts
    let expenseQuery = `
      SELECT COUNT(*) as count
      FROM accounts
      WHERE business_id = $1 AND account_type = 'expense' AND is_active = true
    `;
    const expenseAccounts = await client.query(expenseQuery, [businessId]);
    console.log(`📊 Expense Accounts: ${expenseAccounts.rows[0].count}`);

    if (parseInt(expenseAccounts.rows[0].count) === 0) {
      console.log('   ⚠️  No expense accounts found! This is why expenses show ₹0.00');
      console.log('   💡 Solution: Create expense accounts (e.g., Rent, Salaries, Utilities)');
    } else {
      // Show expense accounts
      const expenseDetails = await client.query(`
        SELECT id, account_code, account_name, account_type
        FROM accounts
        WHERE business_id = $1 AND account_type = 'expense' AND is_active = true
        ORDER BY account_code
        LIMIT 10
      `, [businessId]);
      console.log('   Expense Accounts:');
      expenseDetails.rows.forEach(acc => {
        console.log(`     - ${acc.account_code}: ${acc.account_name}`);
      });
    }
    console.log('');

    // 4. Check ledger entries for income accounts
    let incomeLedgerQuery = `
      SELECT 
        COUNT(*) as entry_count,
        COALESCE(SUM(credit - debit), 0) as total_income
      FROM ledger_entry_lines lel
      JOIN accounts a ON lel.account_id = a.id
      WHERE lel.business_id = $1
        AND a.account_type = 'income'
        AND lel.entry_date >= $2
        AND lel.entry_date <= $3
    `;
    const params = [businessId, fromDate, toDate];
    if (branchId) {
      incomeLedgerQuery += ' AND lel.branch_id = $4';
      params.push(branchId);
    }
    const incomeLedger = await client.query(incomeLedgerQuery, params);
    console.log(`💰 Income Ledger Entries: ${incomeLedger.rows[0].entry_count}`);
    console.log(`   Total Income: ₹${parseFloat(incomeLedger.rows[0].total_income).toFixed(2)}`);

    if (parseInt(incomeLedger.rows[0].entry_count) === 0) {
      console.log('   ⚠️  No ledger entries found for income accounts in this date range!');
      console.log('   💡 Solution: Create invoices or journal entries that post to income accounts');
      
      // Check if there are entries outside the date range
      let checkAllQuery = `
        SELECT COUNT(*) as count
        FROM ledger_entry_lines lel
        JOIN accounts a ON lel.account_id = a.id
        WHERE lel.business_id = $1 AND a.account_type = 'income'
      `;
      if (branchId) {
        checkAllQuery += ' AND lel.branch_id = $2';
        const allIncome = await client.query(checkAllQuery, [businessId, branchId]);
        console.log(`   📅 Total income entries (all time): ${allIncome.rows[0].count}`);
      } else {
        const allIncome = await client.query(checkAllQuery, [businessId]);
        console.log(`   📅 Total income entries (all time): ${allIncome.rows[0].count}`);
      }
    }
    console.log('');

    // 5. Check ledger entries for expense accounts
    let expenseLedgerQuery = `
      SELECT 
        COUNT(*) as entry_count,
        COALESCE(SUM(debit - credit), 0) as total_expenses
      FROM ledger_entry_lines lel
      JOIN accounts a ON lel.account_id = a.id
      WHERE lel.business_id = $1
        AND a.account_type = 'expense'
        AND lel.entry_date >= $2
        AND lel.entry_date <= $3
    `;
    const expenseParams = [businessId, fromDate, toDate];
    if (branchId) {
      expenseLedgerQuery += ' AND lel.branch_id = $4';
      expenseParams.push(branchId);
    }
    const expenseLedger = await client.query(expenseLedgerQuery, expenseParams);
    console.log(`💸 Expense Ledger Entries: ${expenseLedger.rows[0].entry_count}`);
    console.log(`   Total Expenses: ₹${parseFloat(expenseLedger.rows[0].total_expenses).toFixed(2)}`);

    if (parseInt(expenseLedger.rows[0].entry_count) === 0) {
      console.log('   ⚠️  No ledger entries found for expense accounts in this date range!');
      console.log('   💡 Solution: Create purchases, expenses, or journal entries that post to expense accounts');
      
      // Check if there are entries outside the date range
      let checkAllQuery = `
        SELECT COUNT(*) as count
        FROM ledger_entry_lines lel
        JOIN accounts a ON lel.account_id = a.id
        WHERE lel.business_id = $1 AND a.account_type = 'expense'
      `;
      if (branchId) {
        checkAllQuery += ' AND lel.branch_id = $2';
        const allExpense = await client.query(checkAllQuery, [businessId, branchId]);
        console.log(`   📅 Total expense entries (all time): ${allExpense.rows[0].count}`);
      } else {
        const allExpense = await client.query(checkAllQuery, [businessId]);
        console.log(`   📅 Total expense entries (all time): ${allExpense.rows[0].count}`);
      }
    }
    console.log('');

    // 6. Check branch filtering
    if (branchId) {
      const branch = await client.query(
        'SELECT id, name FROM branches WHERE id = $1 AND business_id = $2',
        [branchId, businessId]
      );
      if (branch.rows.length === 0) {
        console.log(`❌ Branch ${branchId} not found or doesn't belong to this business!`);
      } else {
        console.log(`✅ Branch: ${branch.rows[0].name}`);
        
        // Check if ledger entries exist for this branch
        const branchEntries = await client.query(`
          SELECT COUNT(*) as count
          FROM ledger_entry_lines
          WHERE business_id = $1 AND branch_id = $2
            AND entry_date >= $3 AND entry_date <= $4
        `, [businessId, branchId, fromDate, toDate]);
        console.log(`   Ledger entries in this branch: ${branchEntries.rows[0].count}`);
      }
      console.log('');
    }

    // 7. Check invoices (which should create income entries)
    let invoiceQuery = `
      SELECT COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
      FROM invoices
      WHERE business_id = $1
        AND invoice_date >= $2
        AND invoice_date <= $3
        AND status != 'cancelled'
    `;
    const invoiceParams = [businessId, fromDate, toDate];
    if (branchId) {
      invoiceQuery += ' AND branch_id = $4';
      invoiceParams.push(branchId);
    }
    const invoices = await client.query(invoiceQuery, invoiceParams);
    console.log(`📄 Invoices in date range: ${invoices.rows[0].count}`);
    console.log(`   Total Invoice Amount: ₹${parseFloat(invoices.rows[0].total).toFixed(2)}`);
    
    if (parseInt(invoices.rows[0].count) > 0 && parseFloat(incomeLedger.rows[0].total_income) === 0) {
      console.log('   ⚠️  Invoices exist but no income ledger entries!');
      console.log('   💡 This suggests invoices are not posting to ledger accounts');
    }
    console.log('');

    // 8. Check purchases (which should create expense entries)
    let purchaseQuery = `
      SELECT COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
      FROM purchases
      WHERE business_id = $1
        AND bill_date >= $2
        AND bill_date <= $3
        AND status != 'cancelled'
    `;
    const purchaseParams = [businessId, fromDate, toDate];
    if (branchId) {
      purchaseQuery += ' AND branch_id = $4';
      purchaseParams.push(branchId);
    }
    const purchases = await client.query(purchaseQuery, purchaseParams);
    console.log(`🛒 Purchases in date range: ${purchases.rows[0].count}`);
    console.log(`   Total Purchase Amount: ₹${parseFloat(purchases.rows[0].total).toFixed(2)}`);
    
    if (parseInt(purchases.rows[0].count) > 0 && parseFloat(expenseLedger.rows[0].total_expenses) === 0) {
      console.log('   ⚠️  Purchases exist but no expense ledger entries!');
      console.log('   💡 This suggests purchases are not posting to ledger accounts');
    }
    console.log('');

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 SUMMARY:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const hasIncomeAccounts = parseInt(incomeAccounts.rows[0].count) > 0;
    const hasExpenseAccounts = parseInt(expenseAccounts.rows[0].count) > 0;
    const hasIncomeEntries = parseInt(incomeLedger.rows[0].entry_count) > 0;
    const hasExpenseEntries = parseInt(expenseLedger.rows[0].entry_count) > 0;

    if (!hasIncomeAccounts) {
      console.log('❌ No income accounts - Create income accounts first');
    } else if (!hasIncomeEntries) {
      console.log('❌ No income ledger entries - Create invoices or journal entries');
    } else {
      console.log('✅ Income data is available');
    }

    if (!hasExpenseAccounts) {
      console.log('❌ No expense accounts - Create expense accounts first');
    } else if (!hasExpenseEntries) {
      console.log('❌ No expense ledger entries - Create purchases, expenses, or journal entries');
    } else {
      console.log('✅ Expense data is available');
    }

    if (hasIncomeAccounts && hasExpenseAccounts && !hasIncomeEntries && !hasExpenseEntries) {
      console.log('\n💡 TIP: Accounts exist but no transactions. Try:');
      console.log('   1. Create an invoice (posts to Sales/Income account)');
      console.log('   2. Create a purchase (posts to Purchase/Expense account)');
      console.log('   3. Create a journal entry manually');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Get command line arguments
const businessId = process.argv[2];
const fromDate = process.argv[3] || new Date(new Date().getFullYear(), 3, 1).toISOString().split('T')[0]; // April 1
const toDate = process.argv[4] || new Date().toISOString().split('T')[0];
const branchId = process.argv[5] || null;

if (!businessId) {
  console.error('Usage: node scripts/diagnose-profit-loss.js <business_id> [from_date] [to_date] [branch_id]');
  console.error('\nExample:');
  console.error('  node scripts/diagnose-profit-loss.js d1f4d605-88aa-4059-ad8c-08fb48e80032');
  console.error('  node scripts/diagnose-profit-loss.js d1f4d605-88aa-4059-ad8c-08fb48e80032 2025-01-01 2025-12-31');
  process.exit(1);
}

diagnose(businessId, fromDate, toDate, branchId).catch(console.error);
