import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { GoogleDriveService, DropboxService } from '@/lib/cloud-storage';

/**
 * GET /api/cron/process-scheduled-backups
 * Process all due backup schedules
 * This endpoint should be called by a cron job every hour
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid cron secret' },
        { status: 401 }
      );
    }

    const now = new Date();
    console.log(`[Scheduled Backups] Processing at ${now.toISOString()}`);

    // Find all schedules that are due
    const dueSchedules = await db.queryRows(`
      SELECT * FROM backup_schedules
      WHERE is_enabled = true
        AND next_run_at <= $1
      ORDER BY next_run_at ASC
    `, [now]);

    if (dueSchedules.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No backups due at this time',
        processed: 0,
      });
    }

    console.log(`[Scheduled Backups] Found ${dueSchedules.length} due schedules`);

    const results = [];

    for (const schedule of dueSchedules) {
      try {
        console.log(`[Scheduled Backups] Processing backup for business ${schedule.business_id}`);

        // Create backup
        const backup = await createBackup(schedule.business_id);

        // Upload to cloud storage if configured
        if (schedule.storage_destination === 'google_drive') {
          await uploadToGoogleDrive(schedule.business_id, backup);
        } else if (schedule.storage_destination === 'dropbox') {
          await uploadToDropbox(schedule.business_id, backup);
        }

        // Send notification email if configured
        if (schedule.notification_email) {
          await sendBackupNotification(
            schedule.notification_email,
            schedule.business_id,
            'success',
            backup.metadata?.total_records || 0
          );
        }

        // Update schedule for next run
        const nextRunAt = calculateNextRunAt(
          schedule.frequency,
          schedule.time_of_day,
          schedule.timezone,
          schedule.day_of_week,
          schedule.day_of_month
        );

        await db.query(`
          UPDATE backup_schedules
          SET last_run_at = NOW(),
              next_run_at = $1,
              consecutive_failures = 0,
              updated_at = NOW()
          WHERE id = $2
        `, [nextRunAt, schedule.id]);

        results.push({
          business_id: schedule.business_id,
          success: true,
          next_run_at: nextRunAt,
        });

        console.log(`[Scheduled Backups] Backup completed for business ${schedule.business_id}`);

      } catch (error: any) {
        console.error(`[Scheduled Backups] Error for business ${schedule.business_id}:`, error);

        // Increment failure count
        await db.query(`
          UPDATE backup_schedules
          SET consecutive_failures = consecutive_failures + 1,
              updated_at = NOW()
          WHERE id = $1
        `, [schedule.id]);

        // Send failure notification
        if (schedule.notification_email) {
          await sendBackupNotification(
            schedule.notification_email,
            schedule.business_id,
            'failed',
            0,
            error.message
          );
        }

        results.push({
          business_id: schedule.business_id,
          success: false,
          error: error.message,
        });

        // Disable schedule after 5 consecutive failures
        const updatedSchedule = await db.queryOne(`
          SELECT consecutive_failures FROM backup_schedules WHERE id = $1
        `, [schedule.id]);

        if (updatedSchedule.consecutive_failures >= 5) {
          await db.query(`
            UPDATE backup_schedules
            SET is_enabled = false
            WHERE id = $1
          `, [schedule.id]);
          
          console.log(`[Scheduled Backups] Disabled schedule for business ${schedule.business_id} after 5 failures`);
        }
      }
    }

    // Clean up old backups based on retention policy
    await cleanupOldBackups();

    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} scheduled backups`,
      processed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });

  } catch (error: any) {
    console.error('[Scheduled Backups] Critical error:', error);
    return NextResponse.json(
      { error: 'Failed to process scheduled backups', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Create backup for a business
 */
async function createBackup(businessId: string): Promise<any> {
  const backup: any = {
    version: '2.0',
    created_at: new Date().toISOString(),
    business_id: businessId,
    created_by_user_id: null, // Scheduled backup, no specific user
    metadata: {
      app_name: 'Khatario',
      backup_type: 'scheduled',
    },
  };

  // Fetch all data (simplified - reuse logic from backup/create API)
  const tables = [
    'business_settings', 'customers', 'suppliers', 'items', 'item_categories',
    'invoices', 'invoice_items', 'purchases', 'purchase_items', 'payments',
    'expenses', 'expense_categories', 'branches', 'warehouses', 'accounts',
    'bank_accounts', 'ledger_entries', 'location_stock', 'stock_movements',
    // Add more tables as needed
  ];

  const stats: any = {};

  for (const table of tables) {
    try {
      const rows = await db.queryRows(`
        SELECT * FROM ${table} WHERE business_id = $1
      `, [businessId]);
      backup[table] = rows;
      stats[table] = rows.length;
    } catch (error) {
      // Table might not exist or have different structure
      backup[table] = [];
      stats[table] = 0;
    }
  }

  backup.metadata.statistics = stats;
  backup.metadata.total_records = Object.values(stats).reduce((sum: number, count: any) => sum + count, 0);

  // Save to backup history
  const backupJson = JSON.stringify(backup);
  const fileSizeBytes = Buffer.byteLength(backupJson, 'utf8');

  await db.query(`
    INSERT INTO backup_history (
      business_id, created_by_user_id, backup_type, backup_version,
      file_size, record_counts, storage_location, status, completed_at
    ) VALUES ($1, NULL, 'scheduled', '2.0', $2, $3, 'cloud', 'completed', NOW())
  `, [businessId, fileSizeBytes, JSON.stringify(stats)]);

  return backup;
}

/**
 * Upload backup to Google Drive
 */
async function uploadToGoogleDrive(businessId: string, backup: any): Promise<void> {
  const driveService = await GoogleDriveService.load(businessId);
  
  if (!driveService) {
    throw new Error('Google Drive not connected');
  }

  const filename = `khatario_scheduled_backup_${businessId}_${new Date().toISOString().split('T')[0]}.json`;
  await driveService.uploadFile(filename, JSON.stringify(backup, null, 2));
}

/**
 * Upload backup to Dropbox
 */
async function uploadToDropbox(businessId: string, backup: any): Promise<void> {
  const dropboxService = await DropboxService.load(businessId);
  
  if (!dropboxService) {
    throw new Error('Dropbox not connected');
  }

  const filename = `khatario_scheduled_backup_${businessId}_${new Date().toISOString().split('T')[0]}.json`;
  await dropboxService.uploadFile(filename, JSON.stringify(backup, null, 2));
}

/**
 * Send backup notification email
 */
async function sendBackupNotification(
  email: string,
  businessId: string,
  status: 'success' | 'failed',
  recordCount: number,
  errorMessage?: string
): Promise<void> {
  // TODO: Implement email sending
  // For now, just log
  console.log(`[Backup Notification] Sending ${status} email to ${email} for business ${businessId}`);
  console.log(`Records: ${recordCount}, Error: ${errorMessage || 'None'}`);
}

/**
 * Clean up old backups based on retention policy
 */
async function cleanupOldBackups(): Promise<void> {
  // Get all schedules with retention policy
  const schedules = await db.queryRows(`
    SELECT business_id, retention_days FROM backup_schedules
    WHERE retention_days IS NOT NULL AND retention_days > 0
  `);

  for (const schedule of schedules) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - schedule.retention_days);

    // Delete old backup history records
    await db.query(`
      DELETE FROM backup_history
      WHERE business_id = $1
        AND backup_type = 'scheduled'
        AND created_at < $2
    `, [schedule.business_id, cutoffDate]);
  }
}

/**
 * Calculate next run timestamp
 */
function calculateNextRunAt(
  frequency: string,
  timeOfDay: string,
  timezone: string,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null
): Date {
  const now = new Date();
  const [hours, minutes] = timeOfDay.split(':').map(Number);

  let nextRun = new Date(now);
  nextRun.setHours(hours, minutes, 0, 0);

  if (frequency === 'daily') {
    nextRun.setDate(nextRun.getDate() + 1);
  } else if (frequency === 'weekly') {
    nextRun.setDate(nextRun.getDate() + 7);
  } else if (frequency === 'monthly') {
    nextRun.setMonth(nextRun.getMonth() + 1);
  }

  return nextRun;
}
