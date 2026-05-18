import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * POST /api/cloud-storage/google/disconnect
 * Disconnect Google Drive from business
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

    // Enforce feature access
    try {
      await assertFeatureAccess(business_id, 'settings_backup');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Deactivate connection
    await db.query(`
      UPDATE cloud_storage_connections
      SET is_active = false, updated_at = NOW()
      WHERE business_id = $1 AND provider = 'google_drive'
    `, [business_id]);

    return NextResponse.json({
      success: true,
      message: 'Google Drive disconnected successfully',
    });

  } catch (error: any) {
    console.error('Error disconnecting Google Drive:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect Google Drive', details: error.message },
      { status: 500 }
    );
  }
}
