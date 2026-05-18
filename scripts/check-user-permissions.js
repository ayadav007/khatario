/**
 * Script to check and diagnose user permissions for reports
 * 
 * Usage: node scripts/check-user-permissions.js <user_id>
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });

// Get database config (same as lib/db.ts)
function getDbConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  
  const password = process.env.DB_PASSWORD;
  if (password === undefined && !process.env.DATABASE_URL) {
    console.error('❌ DB_PASSWORD is not set in environment variables!');
    console.error('   Please set DB_PASSWORD in .env or use DATABASE_URL');
    process.exit(1);
  }
  
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'khatario',
    user: process.env.DB_USER || 'postgres',
    password: password,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

const pool = new Pool(getDbConfig());

async function checkUserPermissions(userId) {
  const client = await pool.connect();
  
  try {
    console.log('\n🔍 CHECKING USER PERMISSIONS\n');
    console.log(`User ID: ${userId}\n`);
    console.log('='.repeat(60));

    // 1. Get user info
    const user = await client.query(
      `SELECT 
        id, 
        email, 
        name, 
        role_id, 
        business_id, 
        is_primary_admin
      FROM users 
      WHERE id = $1`,
      [userId]
    );

    if (user.rows.length === 0) {
      console.log('❌ User not found!');
      return;
    }

    const userData = user.rows[0];
    console.log(`\n1️⃣  User Information:`);
    console.log(`   - Name: ${userData.name || 'N/A'}`);
    console.log(`   - Email: ${userData.email || 'N/A'}`);
    console.log(`   - Business ID: ${userData.business_id}`);
    console.log(`   - Is Primary Admin: ${userData.is_primary_admin ? 'Yes' : 'No'}`);
    console.log(`   - Role ID: ${userData.role_id || 'NOT ASSIGNED'}`);

    // 2. Check if user has a role
    if (!userData.role_id) {
      console.log(`\n⚠️  WARNING: User does not have a role assigned!`);
      
      if (userData.is_primary_admin && userData.business_id) {
        console.log(`\n   Attempting to find Primary Admin role...`);
        const primaryAdminRole = await client.query(
          `SELECT id, role_name FROM user_roles 
           WHERE business_id = $1 AND role_key = 'primary_admin'`,
          [userData.business_id]
        );
        
        if (primaryAdminRole.rows.length > 0) {
          console.log(`   ✅ Found Primary Admin role: ${primaryAdminRole.rows[0].id}`);
          console.log(`   💡 You should assign this role to the user.`);
        } else {
          console.log(`   ❌ Primary Admin role not found for this business!`);
          console.log(`   💡 Run the role initialization endpoint to create roles.`);
        }
      }
    }

    // 3. Check role permissions for 'reports' module
    if (userData.role_id) {
      const rolePermissions = await client.query(
        `SELECT 
          rp.module_key,
          rp.can_view,
          rp.can_add,
          rp.can_modify,
          rp.can_delete,
          rp.can_share,
          ur.role_name,
          ur.role_key
        FROM role_permissions rp
        JOIN user_roles ur ON rp.role_id = ur.id
        WHERE rp.role_id = $1 AND rp.module_key = 'reports'`,
        [userData.role_id]
      );

      console.log(`\n2️⃣  Reports Module Permissions:`);
      if (rolePermissions.rows.length === 0) {
        console.log(`   ❌ NO PERMISSIONS FOUND for 'reports' module!`);
        console.log(`   💡 This is why you're getting a 403 error.`);
      } else {
        const perm = rolePermissions.rows[0];
        console.log(`   - Role: ${perm.role_name} (${perm.role_key})`);
        console.log(`   - Can View (read): ${perm.can_view ? '✅ Yes' : '❌ No'}`);
        console.log(`   - Can Add (create): ${perm.can_add ? '✅ Yes' : '❌ No'}`);
        console.log(`   - Can Modify (update): ${perm.can_modify ? '✅ Yes' : '❌ No'}`);
        console.log(`   - Can Delete: ${perm.can_delete ? '✅ Yes' : '❌ No'}`);
        console.log(`   - Can Share (export): ${perm.can_share ? '✅ Yes' : '❌ No'}`);
        
        if (!perm.can_view) {
          console.log(`\n   ⚠️  ISSUE: User does NOT have 'read' permission for reports!`);
          console.log(`   💡 Fix: Grant 'can_view' permission to this role.`);
        }
      }
    }

    // 4. Check all role permissions
    if (userData.role_id) {
      const allPermissions = await client.query(
        `SELECT 
          rp.module_key,
          rp.can_view,
          rp.can_add,
          rp.can_modify,
          rp.can_delete,
          rp.can_share
        FROM role_permissions rp
        WHERE rp.role_id = $1
        ORDER BY rp.module_key`,
        [userData.role_id]
      );

      console.log(`\n3️⃣  All Module Permissions for this Role:`);
      if (allPermissions.rows.length === 0) {
        console.log(`   ❌ No permissions assigned to this role!`);
      } else {
        allPermissions.rows.forEach(perm => {
          const perms = [];
          if (perm.can_view) perms.push('view');
          if (perm.can_add) perms.push('add');
          if (perm.can_modify) perms.push('modify');
          if (perm.can_delete) perms.push('delete');
          if (perm.can_share) perms.push('share');
          console.log(`   - ${perm.module_key}: ${perms.length > 0 ? perms.join(', ') : '❌ None'}`);
        });
      }
    }

    // 5. Check if reports module exists
    const reportsModule = await client.query(
      `SELECT module_key, module_name, is_active 
       FROM permission_modules 
       WHERE module_key = 'reports'`
    );

    console.log(`\n4️⃣  Reports Module Status:`);
    if (reportsModule.rows.length === 0) {
      console.log(`   ❌ 'reports' module not found in permission_modules!`);
      console.log(`   💡 This is a critical issue. The module needs to exist.`);
    } else {
      const mod = reportsModule.rows[0];
      console.log(`   - Module Key: ${mod.module_key}`);
      console.log(`   - Module Name: ${mod.module_name}`);
      console.log(`   - Is Active: ${mod.is_active ? '✅ Yes' : '❌ No'}`);
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`\n📊 SUMMARY:\n`);
    
    const hasReportsPermission = userData.role_id && 
      (await client.query(
        `SELECT can_view FROM role_permissions 
         WHERE role_id = $1 AND module_key = 'reports'`,
        [userData.role_id]
      )).rows.length > 0 && 
      (await client.query(
        `SELECT can_view FROM role_permissions 
         WHERE role_id = $1 AND module_key = 'reports' AND can_view = true`,
        [userData.role_id]
      )).rows.length > 0;

    if (!hasReportsPermission) {
      console.log(`❌ User does NOT have report.read permission!`);
      console.log(`\n🔧 TO FIX:`);
      console.log(`   1. Go to Settings > Roles & Permissions`);
      console.log(`   2. Find the user's role`);
      console.log(`   3. Enable "Can View" permission for "Reports" module`);
      console.log(`   4. Or assign the user to "Primary Admin" role (which has all permissions)`);
    } else {
      console.log(`✅ User has report.read permission!`);
      console.log(`   If you're still getting 403, check:`);
      console.log(`   - Branch access restrictions`);
      console.log(`   - Policy-based access control (PBAC) rules`);
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
const userId = process.argv[2];

if (!userId) {
  console.error('Usage: node scripts/check-user-permissions.js <user_id>');
  console.error('Example: node scripts/check-user-permissions.js 3c444fb8-9402-4ce1-96a4-54e15889df63');
  process.exit(1);
}

checkUserPermissions(userId).catch(console.error);
