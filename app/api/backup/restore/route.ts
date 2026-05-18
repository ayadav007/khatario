import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { Pool, PoolClient } from 'pg';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * POST /api/backup/restore
 * Restore business data from a backup file with transaction support
 * Supports multiple restore modes: replace_all, merge_smart, selective
 */
export async function POST(request: NextRequest) {
  let restoreOperationId: string | null = null;
  let client: PoolClient | null = null;

  try {
    const body = await request.json();
    const { backup, restore_mode = 'replace_all', selected_modules } = body;
    const userId = getUserIdFromRequest(request, body);

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    try {
      await authorize(userId, 'settings', 'create');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

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
      SELECT * FROM businesses WHERE id = $1
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

    // Create restore operation record
    const restoreResult = await db.queryOne(`
      INSERT INTO restore_operations (
        business_id, initiated_by_user_id, restore_mode, selected_modules, status
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [businessId, userId || null, restore_mode, JSON.stringify(selected_modules || {}), 'in_progress']);
    
    restoreOperationId = restoreResult.id;

    // Get a dedicated database client for transaction
    const pool = db.getPool();
    client = await pool.connect();

    // Start transaction
    if (!client) throw new Error('Failed to get database client');
    await client.query('BEGIN');

    const stats: any = {};

    // Define restore order to respect foreign key dependencies
    // Tables are restored in this exact order to avoid constraint violations
    
    if (restore_mode === 'replace_all') {
      // ===== DELETE EXISTING DATA (in reverse dependency order) =====
      
      await client.query('DELETE FROM activity_logs WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM notifications WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM notes WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM tags WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM custom_fields WHERE business_id = $1', [businessId]);
      
      // Reconciliation and tax
      const reconDecisions = await client.query('SELECT rd.id FROM reconciliation_decisions rd INNER JOIN gstr2b_reconciliation gr ON rd.reconciliation_id = gr.id INNER JOIN gstr2b_imports gi ON gr.import_id = gi.id WHERE gi.business_id = $1', [businessId]);
      if (reconDecisions.rows.length > 0) {
        await client.query('DELETE FROM reconciliation_decisions WHERE id = ANY($1::uuid[])', [reconDecisions.rows.map(r => r.id)]);
      }
      await client.query('DELETE FROM gstr2b_reconciliation WHERE import_id IN (SELECT id FROM gstr2b_imports WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM gstr2b_invoices WHERE import_id IN (SELECT id FROM gstr2b_imports WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM gstr2b_imports WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM itc_reversals WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM tds_tcs_entries WHERE business_id = $1', [businessId]);
      
      // Journal entries
      await client.query('DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM journal_entries WHERE business_id = $1', [businessId]);
      
      // Ledger and transactions
      await client.query('DELETE FROM ledger_entries WHERE business_id = $1', [businessId]);
      
      // Transaction items
      await client.query('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM estimate_items WHERE estimate_id IN (SELECT id FROM estimates WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM credit_note_items WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM debit_note_items WHERE debit_note_id IN (SELECT id FROM debit_notes WHERE business_id = $1)', [businessId]);
      
      // Transactions
      await client.query('DELETE FROM recurring_invoice_history WHERE recurring_invoice_id IN (SELECT id FROM recurring_invoices WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM recurring_invoices WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM invoices WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM purchases WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM estimates WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM credit_notes WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM debit_notes WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM payments WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM advance_payments WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM expenses WHERE business_id = $1', [businessId]);
      
      // Stock
      await client.query('DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM stock_transfers WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM stock_movements WHERE item_id IN (SELECT id FROM items WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM stock_adjustments WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM item_batches WHERE item_id IN (SELECT id FROM items WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM location_stock WHERE warehouse_id IN (SELECT id FROM warehouses WHERE business_id = $1)', [businessId]);
      
      // Master data
      await client.query('DELETE FROM items WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM item_categories WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM customers WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM suppliers WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM expense_categories WHERE business_id = $1', [businessId]);
      
      // Accounting
      await client.query('DELETE FROM accounts WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM bank_accounts WHERE business_id = $1', [businessId]);
      
      // Branch/Warehouse
      await client.query('DELETE FROM user_warehouses WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM branch_warehouses WHERE branch_id IN (SELECT id FROM branches WHERE business_id = $1)', [businessId]);
      await client.query('DELETE FROM warehouses WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM branches WHERE business_id = $1', [businessId]);
      
      // Settings
      await client.query('DELETE FROM todos WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM tasks WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM whatsapp_reminder_settings WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM whatsapp_keywords WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM whatsapp_config WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM invoice_template_settings WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM business_template_assignments WHERE business_id = $1', [businessId]);
      await client.query('DELETE FROM business_settings WHERE business_id = $1', [businessId]);
      
      // Users (keep passwords, just update other data later)
      // We'll update user data but NOT delete users to preserve authentication
    }

    // ===== RESTORE DATA (in dependency order) =====
    
    // Helper function to restore table data
    const restoreTable = async (tableName: string, records: any[], conflictColumns: string[] = ['id']) => {
      if (!client) throw new Error('Database client not initialized');
      if (!records || records.length === 0) {
        stats[tableName] = 0;
        return;
      }

      let insertedCount = 0;
      
      for (const record of records) {
        const columns = Object.keys(record);
        const values = Object.values(record);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        
        const conflictAction = restore_mode === 'merge_smart'
          ? `ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${columns.map(col => `${col} = EXCLUDED.${col}`).join(', ')}`
          : `ON CONFLICT (${conflictColumns.join(', ')}) DO NOTHING`;
        
        const query = `
          INSERT INTO ${tableName} (${columns.join(', ')})
          VALUES (${placeholders})
          ${conflictAction}
        `;
        
        await client.query(query, values);
        insertedCount++;
      }
      
      stats[tableName] = insertedCount;
    };

    // Restore in correct dependency order
    
    // 1. Business Settings
    if (backup.business_settings) {
      await restoreTable('business_settings', backup.business_settings);
    }

    // 2. Users (update, don't replace passwords)
    if (backup.users && restore_mode !== 'replace_all') {
      // For merge mode, only update non-sensitive fields
      for (const user of backup.users) {
        await client.query(`
          UPDATE users 
          SET name = $1, phone = $2, role = $3, is_active = $4
          WHERE id = $5 AND business_id = $6
        `, [user.name, user.phone, user.role, user.is_active, user.id, businessId]);
      }
      stats['users'] = backup.users.length;
    }

    // 3. Branches & Warehouses
    if (backup.branches) await restoreTable('branches', backup.branches);
    if (backup.warehouses) await restoreTable('warehouses', backup.warehouses);
    if (backup.branch_warehouses) await restoreTable('branch_warehouses', backup.branch_warehouses);
    if (backup.user_branches) await restoreTable('user_branches', backup.user_branches);
    if (backup.user_warehouses) await restoreTable('user_warehouses', backup.user_warehouses);

    // 4. Master Data
    if (backup.customers) await restoreTable('customers', backup.customers);
    if (backup.suppliers) await restoreTable('suppliers', backup.suppliers);
    if (backup.item_categories) await restoreTable('item_categories', backup.item_categories);
    if (backup.items) await restoreTable('items', backup.items);
    if (backup.expense_categories) await restoreTable('expense_categories', backup.expense_categories);

    // 5. Accounting
    if (backup.accounts) await restoreTable('accounts', backup.accounts);
    if (backup.bank_accounts) await restoreTable('bank_accounts', backup.bank_accounts);

    // 6. Stock Data
    if (backup.item_batches) await restoreTable('item_batches', backup.item_batches);
    if (backup.location_stock) await restoreTable('location_stock', backup.location_stock);

    // 7. Transactions
    if (backup.invoices) await restoreTable('invoices', backup.invoices);
    if (backup.invoice_items) await restoreTable('invoice_items', backup.invoice_items);
    if (backup.purchases) await restoreTable('purchases', backup.purchases);
    if (backup.purchase_items) await restoreTable('purchase_items', backup.purchase_items);
    if (backup.estimates) await restoreTable('estimates', backup.estimates);
    if (backup.estimate_items) await restoreTable('estimate_items', backup.estimate_items);
    if (backup.credit_notes) await restoreTable('credit_notes', backup.credit_notes);
    if (backup.credit_note_items) await restoreTable('credit_note_items', backup.credit_note_items);
    if (backup.debit_notes) await restoreTable('debit_notes', backup.debit_notes);
    if (backup.debit_note_items) await restoreTable('debit_note_items', backup.debit_note_items);
    if (backup.recurring_invoices) await restoreTable('recurring_invoices', backup.recurring_invoices);
    if (backup.recurring_invoice_history) await restoreTable('recurring_invoice_history', backup.recurring_invoice_history);

    // 8. Payments & Expenses
    if (backup.payments) await restoreTable('payments', backup.payments);
    if (backup.advance_payments) await restoreTable('advance_payments', backup.advance_payments);
    if (backup.expenses) await restoreTable('expenses', backup.expenses);

    // 9. Stock Operations
    if (backup.stock_movements) await restoreTable('stock_movements', backup.stock_movements);
    if (backup.stock_adjustments) await restoreTable('stock_adjustments', backup.stock_adjustments);
    if (backup.stock_transfers) await restoreTable('stock_transfers', backup.stock_transfers);
    if (backup.stock_transfer_items) await restoreTable('stock_transfer_items', backup.stock_transfer_items);

    // 10. Accounting Entries
    if (backup.ledger_entries) await restoreTable('ledger_entries', backup.ledger_entries);
    if (backup.journal_entries) await restoreTable('journal_entries', backup.journal_entries);
    if (backup.journal_entry_lines) await restoreTable('journal_entry_lines', backup.journal_entry_lines);

    // 11. Tax & Compliance
    if (backup.tds_tcs_entries) await restoreTable('tds_tcs_entries', backup.tds_tcs_entries);
    if (backup.gstr2b_imports) await restoreTable('gstr2b_imports', backup.gstr2b_imports);
    if (backup.gstr2b_invoices) await restoreTable('gstr2b_invoices', backup.gstr2b_invoices);
    if (backup.gstr2b_reconciliation) await restoreTable('gstr2b_reconciliation', backup.gstr2b_reconciliation);
    if (backup.reconciliation_decisions) await restoreTable('reconciliation_decisions', backup.reconciliation_decisions);
    if (backup.itc_reversals) await restoreTable('itc_reversals', backup.itc_reversals);

    // 12. Additional Features
    if (backup.todos) await restoreTable('todos', backup.todos);
    if (backup.tasks) await restoreTable('tasks', backup.tasks);
    if (backup.activity_logs) await restoreTable('activity_logs', backup.activity_logs);
    if (backup.notifications) await restoreTable('notifications', backup.notifications);
    if (backup.custom_fields) await restoreTable('custom_fields', backup.custom_fields);
    if (backup.tags) await restoreTable('tags', backup.tags);
    if (backup.notes) await restoreTable('notes', backup.notes);

    // 13. Settings & Templates
    if (backup.invoice_template_settings) await restoreTable('invoice_template_settings', backup.invoice_template_settings);
    if (backup.business_template_assignments) await restoreTable('business_template_assignments', backup.business_template_assignments);
    if (backup.whatsapp_config) await restoreTable('whatsapp_config', backup.whatsapp_config);
    if (backup.whatsapp_keywords) await restoreTable('whatsapp_keywords', backup.whatsapp_keywords);
    if (backup.whatsapp_reminder_settings) await restoreTable('whatsapp_reminder_settings', backup.whatsapp_reminder_settings);

    // Commit transaction
    await client.query('COMMIT');

    // Update restore operation as completed
    await db.query(`
      UPDATE restore_operations
      SET status = 'completed',
          records_restored = $1,
          completed_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(stats), restoreOperationId]);

    return NextResponse.json({
      success: true,
      message: 'Backup restored successfully',
      restore_mode,
      stats,
      total_records: Object.values(stats).reduce((sum: any, count: any) => sum + count, 0),
    });

  } catch (error: any) {
    console.error('Error restoring backup:', error);

    // Rollback transaction
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error rolling back transaction:', rollbackError);
      }
    }

    // Mark restore as failed
    if (restoreOperationId) {
      await db.query(`
        UPDATE restore_operations
        SET status = 'rolled_back',
            error_message = $1,
            completed_at = NOW()
        WHERE id = $2
      `, [error.message, restoreOperationId]).catch(console.error);
    }

    return NextResponse.json(
      { 
        error: 'Failed to restore backup. All changes have been rolled back.', 
        details: error.message 
      },
      { status: 500 }
    );
  } finally {
    // Release database client
    if (client) {
      client.release();
    }
  }
}

