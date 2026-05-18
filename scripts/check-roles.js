const { Pool } = require('pg');
const fs = require('fs');

// Read database config from .env or use defaults
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'khatario',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function checkRoles() {
  try {
    // Get all roles
    const rolesResult = await pool.query(`
      SELECT id, role_name, description, is_system
      FROM roles
      ORDER BY role_name
    `);
    
    console.log('\n📋 All Roles in System:');
    console.log('─'.repeat(80));
    
    for (const role of rolesResult.rows) {
      console.log(`\n🏷️  ${role.role_name}${role.is_system ? ' (System Role)' : ''}`);
      console.log(`   ID: ${role.id}`);
      console.log(`   Description: ${role.description || 'N/A'}`);
      
      // Check if this role has sales_sales_orders permission
      const permResult = await pool.query(`
        SELECT can_view, can_add, can_edit, can_delete
        FROM role_permissions
        WHERE role_id = $1 AND module_key = 'sales_sales_orders'
      `, [role.id]);
      
      if (permResult.rows.length > 0) {
        const perm = permResult.rows[0];
        console.log(`   sales_sales_orders: ✅ GRANTED`);
        console.log(`      - View: ${perm.can_view ? '✓' : '✗'}`);
        console.log(`      - Create: ${perm.can_add ? '✓' : '✗'}`);
        console.log(`      - Update: ${perm.can_edit ? '✓' : '✗'}`);
        console.log(`      - Delete: ${perm.can_delete ? '✓' : '✗'}`);
      } else {
        console.log(`   sales_sales_orders: ❌ NOT GRANTED`);
      }
    }
    
    console.log('\n' + '─'.repeat(80));
    console.log(`\nTotal roles: ${rolesResult.rows.length}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkRoles();
