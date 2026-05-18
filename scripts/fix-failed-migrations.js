const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'khatario',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

async function run(label, sql) {
  try {
    await pool.query(sql);
    console.log(`  ✅ ${label}`);
    return true;
  } catch (err) {
    const msg = err.message.split('\n')[0];
    if (msg.includes('already exists') || msg.includes('duplicate key')) {
      console.log(`  ⏭️  ${label} (already exists)`);
      return true;
    }
    console.error(`  ❌ ${label}: ${msg}`);
    return false;
  }
}

async function runFile(filePath) {
  const name = path.basename(filePath);
  const sql = fs.readFileSync(filePath, 'utf8');
  return run(name, sql);
}

async function main() {
  console.log('Connecting to database...');
  await pool.query('SELECT NOW()');
  console.log('Connected!\n');

  const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');
  let success = 0;
  let failed = 0;

  // --- Fix 1: 059_rbac.sql ---
  // role_permissions already exists from 019 with a different schema.
  // We only need the `permissions` and `field_permissions` tables + seed data.
  console.log('--- Fix 059: RBAC (permissions & field_permissions tables) ---');
  if (await run('Create permissions table', `
    CREATE TABLE IF NOT EXISTS permissions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      module_id UUID REFERENCES permission_modules(id) ON DELETE CASCADE,
      permission_key VARCHAR(50) NOT NULL,
      permission_name VARCHAR(100) NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(module_id, permission_key)
    );
  `)) success++; else failed++;

  if (await run('Create field_permissions table', `
    CREATE TABLE IF NOT EXISTS field_permissions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      role_id UUID REFERENCES user_roles(id) ON DELETE CASCADE,
      module_key VARCHAR(50) NOT NULL,
      field_name VARCHAR(100) NOT NULL,
      can_view BOOLEAN DEFAULT true,
      can_edit BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(role_id, module_key, field_name)
    );
  `)) success++; else failed++;

  if (await run('Create indexes for permissions', `
    CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module_id);
    CREATE INDEX IF NOT EXISTS idx_field_permissions_role ON field_permissions(role_id, module_key);
  `)) success++; else failed++;

  if (await run('Seed default permissions', `
    DO $$
    DECLARE
      module_rec RECORD;
      perm_keys TEXT[] := ARRAY['create', 'read', 'update', 'delete', 'approve', 'export'];
      perm_names TEXT[] := ARRAY['Create', 'Read', 'Update', 'Delete', 'Approve', 'Export'];
      i INTEGER;
    BEGIN
      FOR module_rec IN SELECT id, module_key FROM permission_modules LOOP
        FOR i IN 1..array_length(perm_keys, 1) LOOP
          INSERT INTO permissions (module_id, permission_key, permission_name)
          VALUES (module_rec.id, perm_keys[i], perm_names[i])
          ON CONFLICT (module_id, permission_key) DO NOTHING;
        END LOOP;
      END LOOP;
    END $$;
  `)) success++; else failed++;

  // --- Fix 2: 060_add_missing_permission_modules.sql ---
  console.log('\n--- Fix 060: Add missing permission modules ---');
  if (await runFile(path.join(migrationsDir, '060_add_missing_permission_modules.sql'))) success++; else failed++;

  // --- Fix 3: Subscription plan feature migrations (075, 076, 130, 143) ---
  console.log('\n--- Fix 075, 076, 130, 143: Subscription plan features ---');
  for (const f of [
    '075_add_inventory_adjustments_feature.sql',
    '076_add_missing_sales_features.sql',
    '130_add_user_id_to_notifications_and_todo_feature.sql',
    '143_add_backup_restore_feature.sql',
  ]) {
    if (await runFile(path.join(migrationsDir, f))) success++; else failed++;
  }

  // --- Fix 4: 083_closing_stock_valuation.sql ---
  // References `locations(id)` which doesn't exist; warehouses table is the correct one.
  console.log('\n--- Fix 083: Closing stock valuation (adapted for warehouses) ---');
  if (await run('Create closing_stock_snapshots', `
    CREATE TABLE IF NOT EXISTS closing_stock_snapshots (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
      financial_year_id UUID REFERENCES financial_years(id) ON DELETE CASCADE,
      financial_year VARCHAR(9) NOT NULL,
      snapshot_date DATE NOT NULL,
      item_id UUID REFERENCES items(id) ON DELETE CASCADE,
      variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL,
      location_id UUID,
      quantity DECIMAL(12,2) NOT NULL,
      unit_cost DECIMAL(12,2) NOT NULL,
      total_value DECIMAL(15,2) NOT NULL,
      valuation_method VARCHAR(20) NOT NULL CHECK (valuation_method IN ('fifo', 'lifo', 'weighted_avg', 'simple')),
      batch_id UUID REFERENCES item_batches(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by UUID REFERENCES users(id),
      UNIQUE(business_id, financial_year_id, item_id, variant_id, location_id, batch_id)
    );
    CREATE TABLE IF NOT EXISTS closing_stock_summary (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
      financial_year_id UUID REFERENCES financial_years(id) ON DELETE CASCADE,
      financial_year VARCHAR(9) NOT NULL,
      total_items INTEGER NOT NULL,
      total_quantity DECIMAL(15,2) NOT NULL,
      total_value DECIMAL(15,2) NOT NULL,
      valuation_method_used VARCHAR(20),
      snapshot_date DATE NOT NULL,
      is_finalized BOOLEAN DEFAULT false,
      finalized_at TIMESTAMP,
      finalized_by UUID REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(business_id, financial_year_id)
    );
    CREATE INDEX IF NOT EXISTS idx_closing_stock_snapshots_business_id ON closing_stock_snapshots(business_id);
    CREATE INDEX IF NOT EXISTS idx_closing_stock_snapshots_financial_year_id ON closing_stock_snapshots(financial_year_id);
    CREATE INDEX IF NOT EXISTS idx_closing_stock_snapshots_item_id ON closing_stock_snapshots(item_id);
    CREATE INDEX IF NOT EXISTS idx_closing_stock_snapshots_snapshot_date ON closing_stock_snapshots(snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_closing_stock_summary_business_id ON closing_stock_summary(business_id);
    CREATE INDEX IF NOT EXISTS idx_closing_stock_summary_financial_year_id ON closing_stock_summary(financial_year_id);
  `)) success++; else failed++;

  // --- Fix 5: 111_invoice_templates.sql ---
  // Table exists from schema.sql with different structure (VARCHAR id, no business_id).
  // Add missing columns to existing table.
  console.log('\n--- Fix 111: Invoice templates (add missing columns) ---');
  if (await run('Add missing columns to invoice_templates', `
    ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id) ON DELETE CASCADE;
    ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS vendor_pattern VARCHAR(255);
    ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS template_yaml TEXT;
    ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS is_global BOOLEAN DEFAULT false;
    ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;
    ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS success_count INTEGER DEFAULT 0;
    ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
    ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    CREATE INDEX IF NOT EXISTS idx_invoice_templates_business ON invoice_templates(business_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_templates_active ON invoice_templates(is_active) WHERE is_active = true;
    CREATE INDEX IF NOT EXISTS idx_invoice_templates_global ON invoice_templates(is_global) WHERE is_global = true;
    CREATE INDEX IF NOT EXISTS idx_invoice_templates_vendor ON invoice_templates(vendor_pattern);
  `)) success++; else failed++;

  // --- Fix 6: 125_branch_warehouse_integrity_fixes.sql ---
  // is_default was added by 128 (which ran successfully). Re-run 125.
  console.log('\n--- Fix 125: Branch warehouse integrity fixes ---');
  if (await runFile(path.join(migrationsDir, '125_branch_warehouse_integrity_fixes.sql'))) success++; else failed++;

  // --- Fix 7: 148_fix_sales_orders_permission.sql ---
  // References `can_edit` (role_permissions has `can_modify` from 019) and `roles` table (it's `user_roles`).
  // Adapt the query.
  console.log('\n--- Fix 148: Fix sales orders permission (adapted) ---');
  if (await run('Add sales_sales_orders permission', `
    INSERT INTO role_permissions (id, role_id, module_key, can_view, can_add, can_modify, can_delete)
    SELECT 
      gen_random_uuid(), r.id, 'sales_sales_orders', true, true, true, true
    FROM user_roles r
    WHERE NOT EXISTS (
      SELECT 1 FROM role_permissions rp 
      WHERE rp.role_id = r.id AND rp.module_key = 'sales_sales_orders'
    );
  `)) success++; else failed++;

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Fix Summary: ✅ ${success} success, ❌ ${failed} failed`);
  console.log(`${'═'.repeat(50)}\n`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
