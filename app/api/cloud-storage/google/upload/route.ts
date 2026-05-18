import { NextRequest, NextResponse } from 'next/server';
import { GoogleDriveService } from '@/lib/cloud-storage';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * POST /api/cloud-storage/google/upload
 * Upload backup file to Google Drive
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, backup_data, filename } = body;

    if (!business_id || !backup_data || !filename) {
      return NextResponse.json(
        { error: 'business_id, backup_data, and filename are required' },
        { status: 400 }
      );
    }

    // Enforce feature access
    try {
      await assertFeatureAccess(business_id, 'settings_backup');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Load Google Drive service
    const driveService = await GoogleDriveService.load(business_id);

    if (!driveService) {
      return NextResponse.json(
        { error: 'Google Drive is not connected for this business' },
        { status: 404 }
      );
    }

    // Upload to Google Drive
    const result = await driveService.uploadFile(filename, backup_data, 'application/json');

    return NextResponse.json({
      success: true,
      file_id: result.fileId,
      file_path: result.filePath,
      message: 'Backup uploaded to Google Drive successfully',
    });

  } catch (error: any) {
    console.error('Error uploading to Google Drive:', error);
    return NextResponse.json(
      { error: 'Failed to upload to Google Drive', details: error.message },
      { status: 500 }
    );
  }
}
