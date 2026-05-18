import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { GoogleDriveService, DropboxService } from '@/lib/cloud-storage';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/backup/history/[id]/download
 * Download a backup file from cloud storage
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const backupId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

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

    // Check if backup is stored in cloud
    if (backup.storage_location === 'local') {
      return NextResponse.json(
        { error: 'This backup was stored locally and cannot be re-downloaded' },
        { status: 400 }
      );
    }

    let backupContent: string;

    // Download from cloud storage
    if (backup.storage_location === 'google_drive') {
      if (!backup.cloud_file_id) {
        return NextResponse.json(
          { error: 'Google Drive file ID not found' },
          { status: 404 }
        );
      }

      const driveService = await GoogleDriveService.load(businessId);
      if (!driveService) {
        return NextResponse.json(
          { error: 'Google Drive not connected' },
          { status: 400 }
        );
      }

      backupContent = await driveService.downloadFile(backup.cloud_file_id);

    } else if (backup.storage_location === 'dropbox') {
      if (!backup.cloud_file_path) {
        return NextResponse.json(
          { error: 'Dropbox file path not found' },
          { status: 404 }
        );
      }

      const dropboxService = await DropboxService.load(businessId);
      if (!dropboxService) {
        return NextResponse.json(
          { error: 'Dropbox not connected' },
          { status: 400 }
        );
      }

      backupContent = await dropboxService.downloadFile(backup.cloud_file_path);

    } else {
      return NextResponse.json(
        { error: 'Unknown storage location' },
        { status: 400 }
      );
    }

    // Generate filename
    const timestamp = new Date(backup.created_at).toISOString().split('T')[0];
    const filename = `khatario_backup_${businessId}_${timestamp}.json`;

    // Return backup as downloadable file
    return new NextResponse(backupContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

  } catch (error: any) {
    console.error('Error downloading backup:', error);
    return NextResponse.json(
      { error: 'Failed to download backup', details: error.message },
      { status: 500 }
    );
  }
}
