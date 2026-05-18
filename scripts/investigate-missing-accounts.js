/**
 * Investigate missing chart of accounts
 * Check if accounts exist but are filtered out, soft-deleted, or actually deleted
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

async function investigate(businessId) {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Investigating Missing Chart of Accounts...\n');
    console.log(`Business ID: ${businessId}\n`);

    // 1. Check if business exists
    const business = await client.query(
      'SELECT id, name, created_at FROM businesses WHERE id = $1',
      [businessId]
    );
    if (business.rows.length === 0) {
      console.log('❌ Business not found!');
      return;
    }
    console.log(`✅ Business: ${business.rows[0].name}`);
    console.log(`   Created: ${business.rows[0].created_at}\n`);

    // 2. Check ALL accounts (including inactive/deleted)
    const allAccounts = await client.query(`
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE is_active = true) as active_count,
        COUNT(*) FILTER (WHERE is_active = false) as inactive_count,
        COUNT(*) FILTER (WHERE account_type = 'income') as income_count,
        COUNT(*) FILTER (WHERE account_type = 'expense') as expense_count,
        COUNT(*) FILTER (WHERE account_type = 'asset') as asset_count,
        COUNT(*) FILTER (WHERE account_type = 'liability') as liability_count,
        COUNT(*) FILTER (WHERE account_type = 'equity') as equity_count,
        MIN(created_at) as first_created,
        MAX(created_at) as last_created,
        MAX(updated_at) as last_updated
      FROM accounts
      WHERE business_id = $1
    `, [businessId]);

    const stats = allAccounts.rows[0];
    console.log('📊 ACCOUNT STATISTICS:');
    console.log(`   Total Accounts: ${stats.total_count}`);
    console.log(`   Active: ${stats.active_count}`);
    console.log(`   Inactive: ${stats.inactive_count}`);
    console.log(`   Income: ${stats.income_count}`);
    console.log(`   Expense: ${stats.expense_count}`);
    console.log(`   Asset: ${stats.asset_count}`);
    console.log(`   Liability: ${stats.liability_count}`);
    console.log(`   Equity: ${stats.equity_count}`);
    if (stats.first_created) {
      console.log(`   First Created: ${stats.first_created}`);
      console.log(`   Last Created: ${stats.last_created}`);
      console.log(`   Last Updated: ${stats.last_updated}`);
    }
    console.log('');

    if (parseInt(stats.total_count) === 0) {
      console.log('❌ NO ACCOUNTS FOUND AT ALL!');
      console.log('   This suggests accounts were deleted or never created.\n');
      
      // Check if there's a default chart of accounts seed
      console.log('🔍 Checking for default chart of accounts...');
      const defaultAccounts = await client.query(`
        SELECT COUNT(*) as count
        FROM accounts
        WHERE business_id IS NULL OR business_id = '00000000-0000-0000-0000-000000000000'
      `);
      console.log(`   Default/Template Accounts: ${defaultAccounts.rows[0].count}\n`);
      
      // Check account_groups
      const accountGroups = await client.query(`
        SELECT COUNT(*) as count
        FROM account_groups
        WHERE business_id = $1
      `, [businessId]);
      console.log(`   Account Groups: ${accountGroups.rows[0].count}\n`);
      
    } else {
      // Show sample accounts
      console.log('📋 SAMPLE ACCOUNTS (first 20):');
      const sampleAccounts = await client.query(`
        SELECT 
          id,
          account_code,
          account_name,
          account_type,
          is_active,
          created_at,
          updated_at
        FROM accounts
        WHERE business_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [businessId]);

      if (sampleAccounts.rows.length > 0) {
        sampleAccounts.rows.forEach((acc, idx) => {
          const status = acc.is_active ? '✅' : '❌';
          console.log(`   ${idx + 1}. ${status} ${acc.account_code} - ${acc.account_name} (${acc.account_type})`);
        });
      }
      console.log('');


      // Check inactive accounts
      if (parseInt(stats.inactive_count) > 0) {
        console.log(`⚠️  Found ${stats.inactive_count} inactive accounts (is_active = false)`);
        console.log('   These accounts exist but are marked as inactive\n');
      }
    }

    // 3. Check account_groups
    console.log('📁 ACCOUNT GROUPS:');
    const groups = await client.query(`
      SELECT 
        id,
        group_code,
        group_name,
        group_type,
        created_at
      FROM account_groups
      WHERE business_id = $1
      ORDER BY group_code
    `, [businessId]);

    console.log(`   Total Groups: ${groups.rows.length}`);
    if (groups.rows.length > 0) {
      groups.rows.forEach((grp, idx) => {
        console.log(`   ${idx + 1}. ✅ ${grp.group_code} - ${grp.group_name} (${grp.group_type})`);
      });
    } else {
      console.log('   ⚠️  No account groups found!');
    }
    console.log('');

    // Check if initialization function exists
    console.log('🔍 CHECKING INITIALIZATION FUNCTION:');
    const functionExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
        AND p.proname = 'create_default_chart_of_accounts'
      ) as exists
    `);
    console.log(`   Function exists: ${functionExists.rows[0].exists ? '✅ Yes' : '❌ No'}`);
    if (!functionExists.rows[0].exists) {
      console.log('   ⚠️  Function not found! Run migration 063_chart_of_accounts_seed.sql');
    }
    console.log('');

    // 4. Check for any migration or script that might have affected accounts
    console.log('🔍 CHECKING FOR DATA ISSUES:');
    
    // Check for accounts with NULL account_type
    const accountsNoType = await client.query(`
      SELECT COUNT(*) as count
      FROM accounts
      WHERE business_id = $1 AND account_type IS NULL
    `, [businessId]);
    console.log(`   Accounts with NULL account_type: ${accountsNoType.rows[0].count}`);

    // Check for accounts with NULL account_code
    const accountsNoCode = await client.query(`
      SELECT COUNT(*) as count
      FROM accounts
      WHERE business_id = $1 AND account_code IS NULL
    `, [businessId]);
    console.log(`   Accounts with NULL account_code: ${accountsNoCode.rows[0].count}`);
    console.log('');

    // 5. Check ledger entries to see if accounts were used
    const ledgerAccounts = await client.query(`
      SELECT DISTINCT account_id, COUNT(*) as entry_count
      FROM ledger_entry_lines
      WHERE business_id = $1
      GROUP BY account_id
      ORDER BY entry_count DESC
      LIMIT 10
    `, [businessId]);

    if (ledgerAccounts.rows.length > 0) {
      console.log('📊 ACCOUNTS USED IN LEDGER (top 10):');
      for (const ledgerAcc of ledgerAccounts.rows) {
        const acc = await client.query(`
          SELECT account_code, account_name, account_type, is_active
          FROM accounts
          WHERE id = $1
        `, [ledgerAcc.account_id]);
        
        if (acc.rows.length > 0) {
          const accInfo = acc.rows[0];
          const status = accInfo.is_active ? '✅' : '❌';
          console.log(`   ${status} ${accInfo.account_code} - ${accInfo.account_name} (${ledgerAcc.entry_count} entries)`);
        } else {
          console.log(`   ⚠️  Account ${ledgerAcc.account_id} used in ledger but NOT FOUND in accounts table!`);
        }
      }
      console.log('');
    }

    // 6. Check if there's a chart_of_accounts_seed or initialization
    console.log('🔍 CHECKING FOR INITIALIZATION:');
    const seedCheck = await client.query(`
      SELECT COUNT(*) as count
      FROM accounts
      WHERE business_id = $1 
        AND (account_code LIKE '4100%' OR account_code LIKE '5100%' OR account_code LIKE '6100%')
    `, [businessId]);
    console.log(`   Standard account codes (4100, 5100, 6100): ${seedCheck.rows[0].count}`);
    
    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 SUMMARY:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (parseInt(stats.total_count) === 0) {
      console.log('❌ NO ACCOUNTS FOUND - Accounts were deleted or never created');
      console.log('💡 Solution: Re-initialize chart of accounts');
    } else if (parseInt(stats.active_count) === 0 && parseInt(stats.total_count) > 0) {
      console.log('⚠️  Accounts exist but ALL are INACTIVE');
      console.log('💡 Solution: Activate accounts (set is_active = true)');
    } else if (parseInt(stats.income_count) === 0 && parseInt(stats.expense_count) === 0) {
      console.log('⚠️  Accounts exist but NO INCOME or EXPENSE accounts');
      console.log('💡 Solution: Create income and expense accounts');
    } else {
      console.log('✅ Accounts exist in database');
      console.log('💡 Check if there\'s a filter in the UI excluding them');
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

if (!businessId) {
  console.error('Usage: node scripts/investigate-missing-accounts.js <business_id>');
  console.error('\nExample:');
  console.error('  node scripts/investigate-missing-accounts.js d1f4d605-88aa-4059-ad8c-08fb48e80032');
  process.exit(1);
}

investigate(businessId).catch(console.error);
