import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * POST /api/suppliers/dashboard/dismiss-alert?alert_id=xxx
 * Dismiss a low stock alert
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const alertId = searchParams.get('alert_id');

    if (!alertId) {
      return NextResponse.json(
        { error: 'alert_id is required' },
        { status: 400 }
      );
    }

    // Get alert to find business_id
    const alert = await queryOne(`
      SELECT supplier_business_id as business_id FROM low_stock_alerts WHERE id = $1
    `, [alertId]);

    if (!alert) {
      return NextResponse.json(
        { error: 'Alert not found' },
        { status: 404 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(alert.business_id, 'supplier_management');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await query(
      `UPDATE low_stock_alerts
      SET alert_status = 'dismissed', dismissed_at = $1
      WHERE id = $2`,
      [new Date(), alertId]
    );

    return NextResponse.json({
      success: true,
      message: 'Alert dismissed successfully'
    });

  } catch (error: any) {
    console.error('Error dismissing alert:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to dismiss alert' },
      { status: 500 }
    );
  }
}

