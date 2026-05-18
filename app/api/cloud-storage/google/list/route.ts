import { NextRequest, NextResponse } from 'next/server';
import { GoogleDriveService } from '@/lib/cloud-storage';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/cloud-storage/google/list
 * List backup files from Google Drive
 */
export async function GET(request: NextRequest) {
  try {
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

    // Load Google Drive service
    const driveService = await GoogleDriveService.load(businessId);

    if (!driveService) {
      return NextResponse.json(
        { error: 'Google Drive is not connected for this business' },
        { status: 404 }
      );
    }

    // List files from Google Drive
    const files = await driveService.listBackupFiles();

    return NextResponse.json({
      success: true,
      files,
      count: files.length,
    });

  } catch (error: any) {
    console.error('Error listing Google Drive files:', error);
    return NextResponse.json(
      { error: 'Failed to list Google Drive files', details: error.message },
      { status: 500 }
    );
  }
}
