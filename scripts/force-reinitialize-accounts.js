/**
 * Force re-initialize Chart of Accounts by temporarily removing existing accounts
 * WARNING: This will delete existing accounts (except ones with ledger entries)
 * 
 * Usage: node scripts/force-reinitialize-accounts.js <business_id>
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

async function forceReinitialize(businessId) {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Force Re-initializing Chart of Accounts...\n');
    console.log(`Business ID: ${businessId}\n`);

    await client.query('BEGIN');

    // Check if business exists
    const business = await client.query(
      'SELECT id, name FROM businesses WHERE id = $1',
      [businessId]
    );
    
    if (business.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('❌ Business not found!');
      return;
    }
    
    console.log(`✅ Business: ${business.rows[0].name}\n`);

    // Check accounts with ledger entries (don't delete these)
    const accountsWithEntries = await client.query(`
      SELECT DISTINCT account_id
      FROM ledger_entry_lines
      WHERE business_id = $1
    `, [businessId]);

    const protectedAccountIds = accountsWithEntries.rows.map(r => r.account_id);
    console.log(`🔒 Protected accounts (have ledger entries): ${protectedAccountIds.length}`);

    // Delete account groups that don't have protected accounts
    // First, find groups that only have unprotected accounts
    let groupsToDelete;
    if (protectedAccountIds.length > 0) {
      groupsToDelete = await client.query(`
        SELECT ag.id, ag.group_code, ag.group_name
        FROM account_groups ag
        WHERE ag.business_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM accounts a
            WHERE a.account_group_id = ag.id
              AND a.id = ANY($2::uuid[])
          )
      `, [businessId, protectedAccountIds]);
    } else {
      groupsToDelete = await client.query(`
        SELECT ag.id, ag.group_code, ag.group_name
        FROM account_groups ag
        WHERE ag.business_id = $1
      `, [businessId]);
    }

    console.log(`🗑️  Deleting ${groupsToDelete.rows.length} account groups without protected accounts...`);
    
    // Delete accounts that don't have ledger entries
    let accountsToDelete;
    if (protectedAccountIds.length > 0) {
      accountsToDelete = await client.query(`
        SELECT id, account_code, account_name
        FROM accounts
        WHERE business_id = $1
          AND id != ALL($2::uuid[])
      `, [businessId, protectedAccountIds]);
    } else {
      accountsToDelete = await client.query(`
        SELECT id, account_code, account_name
        FROM accounts
        WHERE business_id = $1
      `, [businessId]);
    }

    console.log(`🗑️  Deleting ${accountsToDelete.rows.length} accounts without ledger entries...`);
    
    if (accountsToDelete.rows.length > 0) {
      console.log('   Accounts to delete:');
      accountsToDelete.rows.forEach(acc => {
        console.log(`     - ${acc.account_code}: ${acc.account_name}`);
      });
    }

    // Delete accounts first (due to foreign key)
    if (accountsToDelete.rows.length > 0) {
      if (protectedAccountIds.length > 0) {
        await client.query(`
          DELETE FROM accounts
          WHERE business_id = $1
            AND id != ALL($2::uuid[])
        `, [businessId, protectedAccountIds]);
      } else {
        await client.query(`
          DELETE FROM accounts
          WHERE business_id = $1
        `, [businessId]);
      }
    }

    // Delete groups
    if (groupsToDelete.rows.length > 0) {
      await client.query(`
        DELETE FROM account_groups
        WHERE business_id = $1
          AND id = ANY($2::uuid[])
      `, [businessId, groupsToDelete.rows.map(g => g.id)]);
    }

    console.log('✅ Cleanup complete\n');

    // Now call the initialization function
    console.log('🔧 Calling create_default_chart_of_accounts function...');
    
    try {
      await client.query('SELECT create_default_chart_of_accounts($1)', [businessId]);
      console.log('✅ Function executed successfully\n');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    // Get final counts
    const finalAccounts = await client.query(
      'SELECT COUNT(*) as count FROM accounts WHERE business_id = $1',
      [businessId]
    );
    const finalAccountCount = parseInt(finalAccounts.rows[0].count);

    const finalGroups = await client.query(
      'SELECT COUNT(*) as count FROM account_groups WHERE business_id = $1',
      [businessId]
    );
    const finalGroupCount = parseInt(finalGroups.rows[0].count);

    // Show breakdown by type
    const accountTypes = await client.query(`
      SELECT 
        account_type,
        COUNT(*) as count
      FROM accounts
      WHERE business_id = $1
      GROUP BY account_type
      ORDER BY account_type
    `, [businessId]);

    await client.query('COMMIT');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 RESULTS:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Account Groups: ${finalGroupCount}`);
    console.log(`✅ Accounts: ${finalAccountCount}`);
    console.log(`   Protected accounts kept: ${protectedAccountIds.length}\n`);
    
    console.log('📊 Accounts by Type:');
    accountTypes.rows.forEach(row => {
      console.log(`   ${row.account_type}: ${row.count}`);
    });

    console.log('\n✅ Chart of Accounts re-initialized successfully!');
    console.log('💡 You can now view accounts in the Chart of Accounts page');

  } catch (error) {
    await client.query('ROLLBACK');
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
  console.error('Usage: node scripts/force-reinitialize-accounts.js <business_id>');
  console.error('\nExample:');
  console.error('  node scripts/force-reinitialize-accounts.js d1f4d605-88aa-4059-ad8c-08fb48e80032');
  process.exit(1);
}

forceReinitialize(businessId).catch(console.error);
