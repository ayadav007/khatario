import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';

/**
 * POST /api/settings/roles/initialize
 * Create default roles for a business
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Check if required tables exist
    try {
      await query('SELECT 1 FROM user_roles LIMIT 1');
      await query('SELECT 1 FROM permission_modules LIMIT 1');
      await query('SELECT 1 FROM role_permissions LIMIT 1');
    } catch (tableError: any) {
      return NextResponse.json(
        { 
          error: 'Database tables not found. Please run migration 019_user_management_system.sql first.',
          details: tableError.message 
        },
        { status: 500 }
      );
    }

    // Check if roles already exist
    const existingRoles = await queryRows(
      'SELECT id FROM user_roles WHERE business_id = $1',
      [business_id]
    );

    if (existingRoles.length > 0) {
      return NextResponse.json(
        { error: 'Roles already exist for this business' },
        { status: 400 }
      );
    }

    // Ensure permission modules exist (seed if missing)
    const existingModules = await queryRows('SELECT module_key FROM permission_modules');
    
    if (existingModules.length === 0) {
      // Seed permission modules
      const modulesToInsert = [
        { key: 'dashboard', name: 'Dashboard', desc: 'View dashboard and analytics', order: 1 },
        { key: 'invoices', name: 'Sales / Invoices', desc: 'Manage sales invoices', order: 2 },
        { key: 'credit_notes', name: 'Credit Notes', desc: 'Manage credit notes (sales returns)', order: 3 },
        { key: 'customers', name: 'Customers', desc: 'Manage customer information', order: 4 },
        { key: 'purchases', name: 'Purchases', desc: 'Manage purchase bills', order: 5 },
        { key: 'purchase_returns', name: 'Purchase Returns', desc: 'Manage purchase returns', order: 6 },
        { key: 'suppliers', name: 'Suppliers', desc: 'Manage supplier information', order: 7 },
        { key: 'items', name: 'Items & Inventory', desc: 'Manage items and stock', order: 8 },
        { key: 'payments', name: 'Payments', desc: 'Manage payments (in/out)', order: 9 },
        { key: 'reports', name: 'Reports', desc: 'View and export reports', order: 10 },
        { key: 'settings', name: 'Settings', desc: 'Access business settings', order: 11 }
      ];

      for (const mod of modulesToInsert) {
        await query(`
          INSERT INTO permission_modules (module_key, module_name, description, display_order, is_active)
          VALUES ($1, $2, $3, $4, true)
          ON CONFLICT (module_key) DO NOTHING
        `, [mod.key, mod.name, mod.desc, mod.order]);
      }
    }

    // Create Primary Admin role
    const primaryAdminRole = await queryOne(`
      INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [business_id, 'Primary Admin', 'primary_admin', 'Full access to all features', true]);

    // Set all permissions for Primary Admin
    const modules = await queryRows('SELECT module_key FROM permission_modules WHERE is_active = true');
    
    if (modules.length === 0) {
      throw new Error('Permission modules table is empty. Please run migration 019_user_management_system.sql first.');
    }

    for (const module of modules) {
      await query(`
        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES ($1, $2, true, true, true, true, true)
      `, [primaryAdminRole.id, module.module_key]);
    }

    // Create Sales role
    const salesRole = await queryOne(`
      INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [business_id, 'Sales', 'sales', 'Create and manage sales invoices', true]);

    // Set permissions for Sales role
    const salesPermissions = [
      { module: 'dashboard', view: true, add: false, modify: false, delete: false, share: false },
      { module: 'invoices', view: true, add: true, modify: true, delete: false, share: true },
      { module: 'credit_notes', view: true, add: true, modify: false, delete: false, share: false },
      { module: 'customers', view: true, add: true, modify: true, delete: false, share: false },
      { module: 'items', view: true, add: false, modify: false, delete: false, share: false },
      { module: 'payments', view: true, add: true, modify: false, delete: false, share: false },
    ];

    for (const perm of salesPermissions) {
      await query(`
        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [salesRole.id, perm.module, perm.view, perm.add, perm.modify, perm.delete, perm.share]);
    }

    // Create Accountant role
    const accountantRole = await queryOne(`
      INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [business_id, 'Accountant', 'accountant', 'Manage finances and payments', true]);

    // Set permissions for Accountant role
    const accountantPermissions = [
      { module: 'dashboard', view: true, add: false, modify: false, delete: false, share: false },
      { module: 'invoices', view: true, add: false, modify: true, delete: false, share: true },
      { module: 'credit_notes', view: true, add: true, modify: true, delete: false, share: false },
      { module: 'customers', view: true, add: true, modify: true, delete: false, share: false },
      { module: 'purchases', view: true, add: false, modify: true, delete: false, share: false },
      { module: 'purchase_returns', view: true, add: true, modify: true, delete: false, share: false },
      { module: 'suppliers', view: true, add: true, modify: true, delete: false, share: false },
      { module: 'payments', view: true, add: true, modify: true, delete: false, share: false },
      { module: 'reports', view: true, add: false, modify: false, delete: false, share: true },
    ];

    for (const perm of accountantPermissions) {
      await query(`
        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [accountantRole.id, perm.module, perm.view, perm.add, perm.modify, perm.delete, perm.share]);
    }

    // Create Inventory Manager role
    const inventoryRole = await queryOne(`
      INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [business_id, 'Inventory Manager', 'inventory_manager', 'Manage inventory and purchases', true]);

    // Set permissions for Inventory Manager role
    const inventoryPermissions = [
      { module: 'dashboard', view: true, add: false, modify: false, delete: false, share: false },
      { module: 'purchases', view: true, add: true, modify: true, delete: false, share: false },
      { module: 'purchase_returns', view: true, add: true, modify: true, delete: false, share: false },
      { module: 'suppliers', view: true, add: true, modify: true, delete: false, share: false },
      { module: 'items', view: true, add: true, modify: true, delete: true, share: false },
      { module: 'warehouses', view: true, add: true, modify: true, delete: true, share: false }, // Full warehouse access
      { module: 'reports', view: true, add: false, modify: false, delete: false, share: false },
    ];

    for (const perm of inventoryPermissions) {
      await query(`
        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [inventoryRole.id, perm.module, perm.view, perm.add, perm.modify, perm.delete, perm.share]);
    }

    return NextResponse.json({
      success: true,
      message: 'Default roles created successfully',
      roles: [primaryAdminRole.id, salesRole.id, accountantRole.id, inventoryRole.id]
    });
  } catch (error: any) {
    console.error('Error creating default roles:', error);
    return NextResponse.json(
      { error: 'Failed to create default roles', details: error.message },
      { status: 500 }
    );
  }
}

