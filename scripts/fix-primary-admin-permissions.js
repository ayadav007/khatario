/**
 * Fix Primary Admin Permissions
 * 
 * This script ensures Primary Admin role has all permissions for all modules.
 * Run this after adding new modules (e.g., after migration 127).
 * 
 * Usage: node scripts/fix-primary-admin-permissions.js <business_id>
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixPrimaryAdminPermissions(businessId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Get Primary Admin role for this business
    const roleResult = await client.query(
      `SELECT id FROM user_roles 
       WHERE business_id = $1 AND role_key = 'primary_admin'`,
      [businessId]
    );

    if (roleResult.rows.length === 0) {
      console.error(`❌ Primary Admin role not found for business ${businessId}`);
      await client.query('ROLLBACK');
      return;
    }

    const primaryAdminRoleId = roleResult.rows[0].id;
    console.log(`✓ Found Primary Admin role: ${primaryAdminRoleId}`);

    // Get all active permission modules
    const modulesResult = await client.query(
      'SELECT module_key FROM permission_modules WHERE is_active = true'
    );

    if (modulesResult.rows.length === 0) {
      console.error('❌ No permission modules found');
      await client.query('ROLLBACK');
      return;
    }

    console.log(`✓ Found ${modulesResult.rows.length} permission modules`);

    let insertedCount = 0;
    let updatedCount = 0;

    for (const module of modulesResult.rows) {
      const existing = await client.query(
        `SELECT id FROM role_permissions 
         WHERE role_id = $1 AND module_key = $2`,
        [primaryAdminRoleId, module.module_key]
      );

      if (existing.rows.length > 0) {
        // Update existing permission to ensure all flags are true
        await client.query(
          `UPDATE role_permissions 
           SET can_view = true, 
               can_add = true, 
               can_modify = true, 
               can_delete = true, 
               can_share = true,
               updated_at = CURRENT_TIMESTAMP
           WHERE role_id = $1 AND module_key = $2`,
          [primaryAdminRoleId, module.module_key]
        );
        updatedCount++;
      } else {
        // Insert new permission with all flags true
        await client.query(
          `INSERT INTO role_permissions (
            role_id, module_key, can_view, can_add, can_modify, can_delete, can_share
          )
          VALUES ($1, $2, true, true, true, true, true)`,
          [primaryAdminRoleId, module.module_key]
        );
        insertedCount++;
        console.log(`  ✓ Added permissions for module: ${module.module_key}`);
      }
    }

    await client.query('COMMIT');

    console.log(`\n✅ Success!`);
    console.log(`   - Modules processed: ${modulesResult.rows.length}`);
    console.log(`   - Permissions inserted: ${insertedCount}`);
    console.log(`   - Permissions updated: ${updatedCount}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Main execution
const businessId = process.argv[2];

if (!businessId) {
  console.error('Usage: node scripts/fix-primary-admin-permissions.js <business_id>');
  console.error('Or run for all businesses: node scripts/fix-primary-admin-permissions.js --all');
  process.exit(1);
}

if (businessId === '--all') {
  // Fix for all businesses
  pool.query('SELECT id FROM businesses')
    .then(result => {
      console.log(`Found ${result.rows.length} businesses. Fixing permissions...\n`);
      return Promise.all(
        result.rows.map(row => 
          fixPrimaryAdminPermissions(row.id)
            .catch(err => {
              console.error(`Failed for business ${row.id}:`, err.message);
            })
        )
      );
    })
    .then(() => {
      console.log('\n✅ All done!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
} else {
  fixPrimaryAdminPermissions(businessId)
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}
