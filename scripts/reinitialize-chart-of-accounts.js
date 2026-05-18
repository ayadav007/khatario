/**
 * Re-initialize Chart of Accounts for a business
 * This will create missing account groups and accounts, skipping ones that already exist
 * 
 * Usage: node scripts/reinitialize-chart-of-accounts.js <business_id>
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

async function reinitialize(businessId) {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Re-initializing Chart of Accounts...\n');
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

    // Check existing accounts
    const existingAccounts = await client.query(
      'SELECT COUNT(*) as count FROM accounts WHERE business_id = $1',
      [businessId]
    );
    const existingCount = parseInt(existingAccounts.rows[0].count);
    console.log(`📊 Existing accounts: ${existingCount}`);

    // Check existing groups
    const existingGroups = await client.query(
      'SELECT COUNT(*) as count FROM account_groups WHERE business_id = $1',
      [businessId]
    );
    const existingGroupCount = parseInt(existingGroups.rows[0].count);
    console.log(`📁 Existing account groups: ${existingGroupCount}\n`);

    // Check if function exists
    const functionExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
        AND p.proname = 'create_default_chart_of_accounts'
      ) as exists
    `);

    if (!functionExists.rows[0].exists) {
      await client.query('ROLLBACK');
      console.log('❌ Function create_default_chart_of_accounts not found!');
      console.log('💡 Please run migration 063_chart_of_accounts_seed.sql first');
      return;
    }

    console.log('🔧 Calling create_default_chart_of_accounts function...');
    
    // Call the function - it will skip duplicates due to UNIQUE constraints
    try {
      await client.query('SELECT create_default_chart_of_accounts($1)', [businessId]);
      console.log('✅ Function executed successfully\n');
    } catch (error) {
      // If it's a unique constraint violation, rollback and restart transaction
      if (error.code === '23505') {
        await client.query('ROLLBACK');
        await client.query('BEGIN');
        console.log('⚠️  Some accounts/groups already exist, continuing...\n');
      } else {
        await client.query('ROLLBACK');
        throw error;
      }
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
    console.log(`✅ Account Groups: ${finalGroupCount} (was ${existingGroupCount})`);
    console.log(`✅ Accounts: ${finalAccountCount} (was ${existingCount})`);
    console.log(`   New accounts created: ${finalAccountCount - existingCount}`);
    console.log(`   New groups created: ${finalGroupCount - existingGroupCount}\n`);
    
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
  console.error('Usage: node scripts/reinitialize-chart-of-accounts.js <business_id>');
  console.error('\nExample:');
  console.error('  node scripts/reinitialize-chart-of-accounts.js d1f4d605-88aa-4059-ad8c-08fb48e80032');
  process.exit(1);
}

reinitialize(businessId).catch(console.error);
