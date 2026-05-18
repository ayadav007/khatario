import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * POST /api/backup/preview
 * Preview what will be restored from a backup file
 * Shows counts, conflicts, and warnings before actual restore
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { backup, restore_mode = 'replace_all' } = body;

    // Validate backup file
    if (!backup || !backup.version) {
      return NextResponse.json(
        { error: 'Invalid backup file - missing version information' },
        { status: 400 }
      );
    }

    if (!backup.business_id) {
      return NextResponse.json(
        { error: 'Invalid backup file - missing business_id' },
        { status: 400 }
      );
    }

    const businessId = backup.business_id;

    // Verify business exists
    const business = await db.queryOne(`
      SELECT id, name, email FROM businesses WHERE id = $1
    `, [businessId]);

    if (!business) {
      return NextResponse.json(
        { error: 'Business not found. Cannot restore to non-existent business.' },
        { status: 404 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(businessId, 'settings_backup');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Extract backup metadata
    const backupInfo = {
      version: backup.version,
      created_at: backup.created_at,
      business_name: backup.business?.name || 'Unknown',
      created_by: backup.created_by_user_id || 'Unknown',
    };

    // Count records in backup
    const backupCounts: any = {};
    let totalBackupRecords = 0;

    const tables = [
      'customers', 'suppliers', 'items', 'item_categories', 'expense_categories',
      'invoices', 'invoice_items', 'purchases', 'purchase_items',
      'estimates', 'estimate_items', 'credit_notes', 'credit_note_items',
      'debit_notes', 'debit_note_items', 'payments', 'expenses',
      'branches', 'warehouses', 'branch_warehouses', 'user_branches', 'user_warehouses',
      'location_stock', 'stock_movements', 'stock_transfers', 'stock_transfer_items',
      'item_batches', 'stock_adjustments', 'accounts', 'bank_accounts',
      'ledger_entries', 'journal_entries', 'journal_entry_lines',
      'recurring_invoices', 'recurring_invoice_history', 'advance_payments',
      'tds_tcs_entries', 'gstr2b_imports', 'gstr2b_invoices', 'gstr2b_reconciliation',
      'reconciliation_decisions', 'itc_reversals', 'todos', 'tasks',
      'activity_logs', 'notifications', 'custom_fields', 'tags', 'notes',
      'invoice_template_settings', 'business_template_assignments', 'whatsapp_config', 'whatsapp_keywords',
      'whatsapp_reminder_settings', 'business_settings', 'users',
    ];

    for (const table of tables) {
      if (backup[table] && Array.isArray(backup[table])) {
        backupCounts[table] = backup[table].length;
        totalBackupRecords += backup[table].length;
      }
    }

    // Count current records in database
    const currentCounts: any = {};
    let totalCurrentRecords = 0;

    for (const table of tables) {
      if (table === 'users') {
        // Count users
        const result = await db.queryOne(`
          SELECT COUNT(*) as count FROM users WHERE business_id = $1
        `, [businessId]);
        currentCounts[table] = parseInt(result.count);
      } else if (['invoice_items', 'purchase_items', 'estimate_items', 'credit_note_items', 'debit_note_items', 'stock_transfer_items', 'journal_entry_lines'].includes(table)) {
        // These are child tables, need special handling
        if (table === 'invoice_items') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM invoice_items 
            WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        } else if (table === 'purchase_items') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM purchase_items 
            WHERE purchase_id IN (SELECT id FROM purchases WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        } else if (table === 'estimate_items') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM estimate_items 
            WHERE estimate_id IN (SELECT id FROM estimates WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        } else if (table === 'credit_note_items') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM credit_note_items 
            WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        } else if (table === 'debit_note_items') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM debit_note_items 
            WHERE debit_note_id IN (SELECT id FROM debit_notes WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        } else if (table === 'stock_transfer_items') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM stock_transfer_items 
            WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        } else if (table === 'journal_entry_lines') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM journal_entry_lines 
            WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        }
      } else if (['location_stock', 'user_branches', 'user_warehouses'].includes(table)) {
        // Special handling for relationship tables
        if (table === 'location_stock') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM location_stock 
            WHERE warehouse_id IN (SELECT id FROM warehouses WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        } else if (table === 'user_branches') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM user_branches 
            WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        } else if (table === 'user_warehouses') {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM user_warehouses 
            WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        }
      } else {
        // Standard business_id tables
        try {
          const result = await db.queryOne(`
            SELECT COUNT(*) as count FROM ${table} WHERE business_id = $1
          `, [businessId]);
          currentCounts[table] = parseInt(result.count);
        } catch (error) {
          // Table might not exist or doesn't have business_id
          currentCounts[table] = 0;
        }
      }
      
      totalCurrentRecords += currentCounts[table] || 0;
    }

    // Determine what will happen based on restore mode
    const restorePlan: any = {};
    
    for (const table of tables) {
      const backupCount = backupCounts[table] || 0;
      const currentCount = currentCounts[table] || 0;
      
      if (backupCount > 0 || currentCount > 0) {
        restorePlan[table] = {
          current: currentCount,
          backup: backupCount,
          action: restore_mode === 'replace_all' 
            ? `Delete ${currentCount}, Insert ${backupCount}`
            : restore_mode === 'merge_smart'
              ? `Keep ${currentCount}, Update/Insert ${backupCount}`
              : 'Selective restore',
        };
      }
    }

    // Generate warnings
    const warnings = [];
    
    if (restore_mode === 'replace_all') {
      warnings.push({
        level: 'critical',
        message: 'ALL existing data will be permanently deleted and replaced with backup data',
      });
      if (totalCurrentRecords > 0) {
        warnings.push({
          level: 'warning',
          message: `${totalCurrentRecords} existing records will be deleted`,
        });
      }
    }

    if (restore_mode === 'merge_smart') {
      warnings.push({
        level: 'info',
        message: 'Existing records will be updated if they match backup records by ID',
      });
      warnings.push({
        level: 'info',
        message: 'New records from backup will be inserted',
      });
    }

    if (backup.version !== '2.0') {
      warnings.push({
        level: 'warning',
        message: `Backup version ${backup.version} may not be fully compatible. Recommended version is 2.0`,
      });
    }

    if (totalBackupRecords === 0) {
      warnings.push({
        level: 'error',
        message: 'Backup file contains no data to restore',
      });
    }

    // Check for missing critical data
    const criticalTables = ['customers', 'items', 'invoices'];
    const missingCritical = criticalTables.filter(t => !backup[t] || backup[t].length === 0);
    if (missingCritical.length > 0) {
      warnings.push({
        level: 'info',
        message: `Backup does not contain: ${missingCritical.join(', ')}`,
      });
    }

    // Summary statistics
    const summary = {
      total_backup_records: totalBackupRecords,
      total_current_records: totalCurrentRecords,
      tables_in_backup: Object.keys(backupCounts).length,
      tables_with_data: Object.values(backupCounts).filter((c: any) => c > 0).length,
    };

    return NextResponse.json({
      success: true,
      backup_info: backupInfo,
      restore_mode,
      target_business: {
        id: business.id,
        name: business.name,
        email: business.email,
      },
      summary,
      restore_plan: restorePlan,
      warnings,
      can_proceed: warnings.filter(w => w.level === 'error').length === 0,
    });

  } catch (error: any) {
    console.error('Error previewing backup:', error);
    return NextResponse.json(
      { error: 'Failed to preview backup', details: error.message },
      { status: 500 }
    );
  }
}
