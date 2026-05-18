const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'khatario',
  user: 'postgres',
  password: ''
});

async function checkPermission() {
  try {
    const userId = 'd1fab8d5-df31-443d-a9a1-0a3742b6c3de';
    
    // Check user's role
    const userResult = await pool.query(`
      SELECT id, role_id, is_primary_admin
      FROM users
      WHERE id = $1
    `, [userId]);
    
    console.log('\n👤 User Info:');
    console.log(userResult.rows[0]);
    
    if (userResult.rows[0].is_primary_admin) {
      console.log('\n✅ User is PRIMARY ADMIN - should have all permissions');
    }
    
    // Check if sales_sales_orders permission exists
    const permCheckResult = await pool.query(`
      SELECT 
        rp.module_key,
        rp.can_view,
        rp.can_add as can_create,
        rp.can_edit as can_update,
        rp.can_delete
      FROM role_permissions rp
      WHERE rp.role_id = $1
        AND rp.module_key = 'sales_sales_orders'
    `, [userResult.rows[0].role_id]);
    
    console.log('\n🔐 Permission for sales_sales_orders:');
    if (permCheckResult.rows.length === 0) {
      console.log('❌ NO PERMISSION RECORD FOUND!');
    } else {
      console.log(permCheckResult.rows[0]);
    }
    
    // List all sales permissions for this role
    const allSalesPerms = await pool.query(`
      SELECT module_key, can_view, can_add, can_edit, can_delete
      FROM role_permissions
      WHERE role_id = $1
        AND module_key LIKE 'sales_%'
      ORDER BY module_key
    `, [userResult.rows[0].role_id]);
    
    console.log('\n📋 All Sales Permissions:');
    allSalesPerms.rows.forEach(row => {
      console.log(`  - ${row.module_key}: view=${row.can_view}, add=${row.can_add}, edit=${row.can_edit}, delete=${row.can_delete}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkPermission();
