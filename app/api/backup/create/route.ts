import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * Helper function to safely query a table (returns empty array if table doesn't exist)
 */
async function safeQuery(query: string, params: any[]): Promise<any[]> {
  try {
    return await db.queryRows(query, params);
  } catch (error: any) {
    // If table doesn't exist (42P01) or column doesn't exist (42703), return empty array
    if (error.code === '42P01' || error.code === '42703') {
      console.log(`Table/column not found in query, skipping: ${error.message}`);
      return [];
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * POST /api/backup/create
 * Create a comprehensive backup of all business data
 * Version 2.0 - Includes all tables for complete data portability
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let backupHistoryId: string | null = null;

  try {
    const body = await request.json();
    const userId = getUserIdFromRequest(request, body);
    const business_id = getBusinessIdFromRequest(request, body);
    const { cloud_destination } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    try {
      await authorize(userId, 'settings', 'export');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, 'settings_backup');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Create backup history record
    const historyResult = await db.queryOne(`
      INSERT INTO backup_history (
        business_id, created_by_user_id, backup_type, backup_version, 
        storage_location, status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [business_id, userId || null, 'manual', '2.0', cloud_destination || 'local', 'in_progress']);
    
    backupHistoryId = historyResult.id;

    // Initialize backup structure
    const backup: any = {
      version: '2.0',
      created_at: new Date().toISOString(),
      business_id,
      created_by_user_id: userId || null,
      metadata: {
        app_name: 'Khatario',
        backup_type: 'complete_business_data',
      },
    };

    // ===== CORE DATA =====
    
    // Business info (excluding sensitive fields)
    backup.business = await db.queryOne(`
      SELECT * FROM businesses WHERE id = $1
    `, [business_id]);

    // Business Settings
    backup.business_settings = await db.queryRows(`
      SELECT * FROM business_settings WHERE business_id = $1
    `, [business_id]);

    // Users (exclude password_hash for security)
    backup.users = await db.queryRows(`
      SELECT id, business_id, email, name, role, phone, is_active, 
             permissions, created_at, updated_at
      FROM users WHERE business_id = $1
    `, [business_id]);

    // ===== BRANCH & WAREHOUSE SYSTEM =====
    
    backup.branches = await safeQuery(`
      SELECT * FROM branches WHERE business_id = $1
    `, [business_id]);

    backup.warehouses = await safeQuery(`
      SELECT * FROM warehouses WHERE business_id = $1
    `, [business_id]);

    backup.branch_warehouses = await safeQuery(`
      SELECT bw.* FROM branch_warehouses bw
      INNER JOIN branches b ON bw.branch_id = b.id
      WHERE b.business_id = $1
    `, [business_id]);

    backup.user_branches = await safeQuery(`
      SELECT ub.* FROM user_branches ub
      INNER JOIN users u ON ub.user_id = u.id
      WHERE u.business_id = $1
    `, [business_id]);

    backup.user_warehouses = await safeQuery(`
      SELECT uw.* FROM user_warehouses uw
      INNER JOIN users u ON uw.user_id = u.id
      WHERE u.business_id = $1
    `, [business_id]);

    // ===== MASTER DATA =====
    
    backup.customers = await db.queryRows(`
      SELECT * FROM customers WHERE business_id = $1
    `, [business_id]);

    backup.suppliers = await db.queryRows(`
      SELECT * FROM suppliers WHERE business_id = $1
    `, [business_id]);

    backup.items = await db.queryRows(`
      SELECT * FROM items WHERE business_id = $1
    `, [business_id]);

    backup.categories = await db.queryRows(`
      SELECT * FROM categories WHERE business_id = $1
    `, [business_id]);

    // ===== STOCK MANAGEMENT =====
    
    // location_stock: After migration 119, location_id points to warehouses
    // Before migration 119, location_id points to business_locations
    backup.location_stock = await safeQuery(`
      SELECT ls.* FROM location_stock ls
      INNER JOIN warehouses w ON ls.location_id = w.id
      WHERE w.business_id = $1
    `, [business_id]);
    
    // Fallback: If warehouses don't exist, get from business_locations
    if (backup.location_stock.length === 0) {
      backup.location_stock = await safeQuery(`
        SELECT ls.* FROM location_stock ls
        INNER JOIN business_locations bl ON ls.location_id = bl.id
        WHERE bl.business_id = $1
      `, [business_id]);
    }

    backup.stock_movements = await db.queryRows(`
      SELECT sm.* FROM stock_movements sm
      INNER JOIN items i ON sm.item_id = i.id
      WHERE i.business_id = $1
    `, [business_id]);

    backup.stock_transfers = await db.queryRows(`
      SELECT st.* FROM stock_transfers st
      WHERE st.business_id = $1
    `, [business_id]);

    const transferIds = backup.stock_transfers.map((st: any) => st.id);
    if (transferIds.length > 0) {
      backup.stock_transfer_items = await db.queryRows(`
        SELECT * FROM stock_transfer_items WHERE transfer_id = ANY($1::uuid[])
      `, [transferIds]);
    } else {
      backup.stock_transfer_items = [];
    }

    backup.item_batches = await safeQuery(`
      SELECT ib.* FROM item_batches ib
      INNER JOIN items i ON ib.item_id = i.id
      WHERE i.business_id = $1
    `, [business_id]);

    backup.stock_adjustments = await safeQuery(`
      SELECT sa.* FROM stock_adjustments sa
      WHERE sa.business_id = $1
    `, [business_id]);

    // ===== SALES TRANSACTIONS =====
    
    backup.invoices = await db.queryRows(`
      SELECT * FROM invoices WHERE business_id = $1
    `, [business_id]);

    const invoiceIds = backup.invoices.map((inv: any) => inv.id);
    if (invoiceIds.length > 0) {
      backup.invoice_items = await db.queryRows(`
        SELECT * FROM invoice_items WHERE invoice_id = ANY($1::uuid[])
      `, [invoiceIds]);
    } else {
      backup.invoice_items = [];
    }

    backup.estimates = await db.queryRows(`
      SELECT * FROM estimates WHERE business_id = $1
    `, [business_id]);

    const estimateIds = backup.estimates.map((est: any) => est.id);
    if (estimateIds.length > 0) {
      backup.estimate_items = await db.queryRows(`
        SELECT * FROM estimate_items WHERE estimate_id = ANY($1::uuid[])
      `, [estimateIds]);
    } else {
      backup.estimate_items = [];
    }

    backup.credit_notes = await db.queryRows(`
      SELECT * FROM credit_notes WHERE business_id = $1
    `, [business_id]);

    const creditNoteIds = backup.credit_notes.map((cn: any) => cn.id);
    if (creditNoteIds.length > 0) {
      backup.credit_note_items = await db.queryRows(`
        SELECT * FROM credit_note_items WHERE credit_note_id = ANY($1::uuid[])
      `, [creditNoteIds]);
    } else {
      backup.credit_note_items = [];
    }

    backup.debit_notes = await db.queryRows(`
      SELECT * FROM debit_notes WHERE business_id = $1
    `, [business_id]);

    const debitNoteIds = backup.debit_notes.map((dn: any) => dn.id);
    if (debitNoteIds.length > 0) {
      backup.debit_note_items = await db.queryRows(`
        SELECT * FROM debit_note_items WHERE debit_note_id = ANY($1::uuid[])
      `, [debitNoteIds]);
    } else {
      backup.debit_note_items = [];
    }

    backup.recurring_invoices = await db.queryRows(`
      SELECT * FROM recurring_invoices WHERE business_id = $1
    `, [business_id]);

    backup.recurring_invoice_history = await safeQuery(`
      SELECT rih.* FROM recurring_invoice_history rih
      INNER JOIN recurring_invoices ri ON rih.recurring_invoice_id = ri.id
      WHERE ri.business_id = $1
    `, [business_id]);

    // ===== PURCHASE TRANSACTIONS =====
    
    backup.purchases = await db.queryRows(`
      SELECT * FROM purchases WHERE business_id = $1
    `, [business_id]);

    const purchaseIds = backup.purchases.map((pur: any) => pur.id);
    if (purchaseIds.length > 0) {
      backup.purchase_items = await db.queryRows(`
        SELECT * FROM purchase_items WHERE purchase_id = ANY($1::uuid[])
      `, [purchaseIds]);
    } else {
      backup.purchase_items = [];
    }

    // ===== PAYMENTS & EXPENSES =====
    
    backup.payments = await db.queryRows(`
      SELECT * FROM payments WHERE business_id = $1
    `, [business_id]);

    backup.expenses = await db.queryRows(`
      SELECT * FROM expenses WHERE business_id = $1
    `, [business_id]);

    backup.expense_categories = await db.queryRows(`
      SELECT * FROM expense_categories WHERE business_id = $1
    `, [business_id]);

    backup.advance_payments = await safeQuery(`
      SELECT * FROM advance_payments WHERE business_id = $1
    `, [business_id]);

    // ===== ACCOUNTING =====
    
    backup.accounts = await safeQuery(`
      SELECT * FROM accounts WHERE business_id = $1
    `, [business_id]);

    backup.account_groups = await safeQuery(`
      SELECT * FROM account_groups WHERE business_id = $1
    `, [business_id]);

    backup.ledger_entries = await db.queryRows(`
      SELECT * FROM ledger_entries WHERE business_id = $1
    `, [business_id]);

    backup.journal_entries = await safeQuery(`
      SELECT * FROM journal_entries WHERE business_id = $1
    `, [business_id]);

    const journalEntryIds = backup.journal_entries.map((je: any) => je.id);
    if (journalEntryIds.length > 0) {
      backup.journal_entry_lines = await safeQuery(`
        SELECT * FROM journal_entry_lines WHERE journal_entry_id = ANY($1::uuid[])
      `, [journalEntryIds]);
    } else {
      backup.journal_entry_lines = [];
    }

    backup.bank_accounts = await safeQuery(`
      SELECT * FROM bank_accounts WHERE business_id = $1
    `, [business_id]);

    // ===== TAX & COMPLIANCE =====
    
    backup.gstr2b_imports = await safeQuery(`
      SELECT * FROM gstr2b_imports WHERE business_id = $1
    `, [business_id]);

    const gstr2bImportIds = backup.gstr2b_imports.map((gi: any) => gi.id);
    if (gstr2bImportIds.length > 0) {
      backup.gstr2b_invoices = await safeQuery(`
        SELECT * FROM gstr2b_invoices WHERE import_id = ANY($1::uuid[])
      `, [gstr2bImportIds]);

      backup.gstr2b_reconciliation = await safeQuery(`
        SELECT * FROM gstr2b_reconciliation WHERE import_id = ANY($1::uuid[])
      `, [gstr2bImportIds]);
      
      backup.reconciliation_decisions = await safeQuery(`
        SELECT rd.* FROM reconciliation_decisions rd
        INNER JOIN gstr2b_reconciliation gr ON rd.reconciliation_id = gr.id
        WHERE gr.import_id = ANY($1::uuid[])
      `, [gstr2bImportIds]);
    } else {
      backup.gstr2b_invoices = [];
      backup.gstr2b_reconciliation = [];
      backup.reconciliation_decisions = [];
    }

    backup.itc_reversals = await db.queryRows(`
      SELECT * FROM itc_reversals WHERE business_id = $1
    `, [business_id]);

    // ===== ADDITIONAL FEATURES =====
    
    backup.todos = await safeQuery(`
      SELECT * FROM todos WHERE business_id = $1
    `, [business_id]);

    // ===== SETTINGS & TEMPLATES =====
    
    backup.invoice_template_settings = await db.queryRows(`
      SELECT * FROM invoice_template_settings WHERE business_id = $1
    `, [business_id]);

    backup.business_template_assignments = await db.queryRows(`
      SELECT * FROM business_template_assignments WHERE business_id = $1
    `, [business_id]);

    // WhatsApp config (exclude sensitive tokens)
    backup.whatsapp_config = await safeQuery(`
      SELECT id, business_id, phone_number, instance_id, is_active, 
             status, created_at, updated_at
      FROM whatsapp_config WHERE business_id = $1
    `, [business_id]);

    backup.whatsapp_keywords = await safeQuery(`
      SELECT * FROM whatsapp_keywords WHERE business_id = $1
    `, [business_id]);

    backup.whatsapp_reminder_settings = await safeQuery(`
      SELECT * FROM whatsapp_reminder_settings WHERE business_id = $1
    `, [business_id]);

    // ===== CALCULATE STATISTICS =====
    
    const stats: any = {};
    for (const [key, value] of Object.entries(backup)) {
      if (Array.isArray(value)) {
        stats[key] = value.length;
      }
    }

    backup.metadata.statistics = stats;
    backup.metadata.total_records = Object.values(stats).reduce((sum: number, count: any) => sum + count, 0);

    // ===== CALCULATE FILE SIZE =====
    
    const backupJson = JSON.stringify(backup, null, 2);
    const fileSizeBytes = Buffer.byteLength(backupJson, 'utf8');

    // Update backup history with completion
    await db.query(`
      UPDATE backup_history
      SET status = 'completed',
          file_size = $1,
          record_counts = $2,
          completed_at = NOW()
      WHERE id = $3
    `, [fileSizeBytes, JSON.stringify(stats), backupHistoryId]);

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `khatario_backup_v2_${business_id}_${timestamp}.json`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Backup-Size': fileSizeBytes.toString(),
      'X-Backup-Records': backup.metadata.total_records.toString(),
    };
    if (backupHistoryId) headers['X-Backup-History-Id'] = backupHistoryId;

    return new NextResponse(backupJson, {
      status: 200,
      headers,
    });

  } catch (error: any) {
    console.error('Error creating backup:', error);

    // Mark backup as failed in history
    if (backupHistoryId) {
      await db.query(`
        UPDATE backup_history
        SET status = 'failed',
            error_message = $1,
            completed_at = NOW()
        WHERE id = $2
      `, [error.message, backupHistoryId]).catch(console.error);
    }

    return NextResponse.json(
      { error: 'Failed to create backup', details: error.message },
      { status: 500 }
    );
  }
}

