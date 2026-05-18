import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/backup/history/[id]
 * Get details of a specific backup
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
      SELECT 
        bh.*,
        u.name as created_by_name,
        u.email as created_by_email
      FROM backup_history bh
      LEFT JOIN users u ON bh.created_by_user_id = u.id
      WHERE bh.id = $1 AND bh.business_id = $2
    `, [backupId, businessId]);

    if (!backup) {
      return NextResponse.json(
        { error: 'Backup not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      backup,
    });

  } catch (error: any) {
    console.error('Error fetching backup details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup details', details: error.message },
      { status: 500 }
    );
  }
}
