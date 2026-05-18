import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/backup/history
 * Get backup history for a business with pagination and filtering
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status'); // Filter by status
    const backupType = searchParams.get('backup_type'); // Filter by type

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Enforce feature access
    try {
      await assertFeatureAccess(businessId, 'settings_backup');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Build query with filters
    let whereConditions = ['business_id = $1'];
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (status) {
      whereConditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (backupType) {
      whereConditions.push(`backup_type = $${paramIndex}`);
      params.push(backupType);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // Get total count
    const countResult = await db.queryOne(`
      SELECT COUNT(*) as total FROM backup_history
      WHERE ${whereClause}
    `, params);

    const total = parseInt(countResult.total);
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;

    // Get paginated results
    const backups = await db.queryRows(`
      SELECT 
        bh.*,
        u.name as created_by_name,
        u.email as created_by_email
      FROM backup_history bh
      LEFT JOIN users u ON bh.created_by_user_id = u.id
      WHERE ${whereClause}
      ORDER BY bh.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    console.log('Backup history query result:', { 
      businessId, 
      total, 
      backupsCount: backups.length,
      backups 
    }); // DEBUG

    return NextResponse.json({
      success: true,
      backups,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    });

  } catch (error: any) {
    console.error('Error fetching backup history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup history', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/backup/history
 * Delete a specific backup record (and cloud file if applicable)
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const backupId = searchParams.get('id');
    const businessId = searchParams.get('business_id');

    if (!backupId || !businessId) {
      return NextResponse.json(
        { error: 'id and business_id are required' },
        { status: 400 }
      );
    }

    // Enforce feature access
    try {
      await assertFeatureAccess(businessId, 'settings_backup');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get backup details
    const backup = await db.queryOne(`
      SELECT * FROM backup_history
      WHERE id = $1 AND business_id = $2
    `, [backupId, businessId]);

    if (!backup) {
      return NextResponse.json(
        { error: 'Backup not found' },
        { status: 404 }
      );
    }

    // If stored in cloud, delete cloud file
    if (backup.storage_location === 'google_drive' && backup.cloud_file_id) {
      try {
        const { GoogleDriveService } = await import('@/lib/cloud-storage');
        const driveService = await GoogleDriveService.load(businessId);
        if (driveService) {
          await driveService.deleteFile(backup.cloud_file_id);
        }
      } catch (cloudError) {
        console.error('Error deleting cloud file:', cloudError);
        // Continue with database deletion even if cloud deletion fails
      }
    }

    // Delete from database
    await db.query(`
      DELETE FROM backup_history WHERE id = $1
    `, [backupId]);

    return NextResponse.json({
      success: true,
      message: 'Backup deleted successfully',
    });

  } catch (error: any) {
    console.error('Error deleting backup:', error);
    return NextResponse.json(
      { error: 'Failed to delete backup', details: error.message },
      { status: 500 }
    );
  }
}
