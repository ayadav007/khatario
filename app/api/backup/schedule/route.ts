import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/backup/schedule
 * Get backup schedule for a business
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

    const schedule = await db.queryOne(`
      SELECT * FROM backup_schedules WHERE business_id = $1
    `, [businessId]);

    if (!schedule) {
      return NextResponse.json({
        success: true,
        schedule: null,
        message: 'No backup schedule configured',
      });
    }

    return NextResponse.json({
      success: true,
      schedule,
    });

  } catch (error: any) {
    console.error('Error fetching backup schedule:', error);
    return NextResponse.json(
      { error: 'Failed to fetch backup schedule', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/backup/schedule
 * Create or update backup schedule
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      user_id,
      is_enabled,
      frequency,
      time_of_day,
      timezone,
      day_of_week,
      day_of_month,
      storage_destination,
      retention_days,
      notification_email,
    } = body;

    if (!business_id || !frequency || !time_of_day || !storage_destination) {
      return NextResponse.json(
        { error: 'business_id, frequency, time_of_day, and storage_destination are required' },
        { status: 400 }
      );
    }

    // Validate frequency
    if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
      return NextResponse.json(
        { error: 'frequency must be daily, weekly, or monthly' },
        { status: 400 }
      );
    }

    // Validate day_of_week for weekly
    if (frequency === 'weekly' && (day_of_week === null || day_of_week === undefined)) {
      return NextResponse.json(
        { error: 'day_of_week is required for weekly frequency (0-6)' },
        { status: 400 }
      );
    }

    // Validate day_of_month for monthly
    if (frequency === 'monthly' && (day_of_month === null || day_of_month === undefined)) {
      return NextResponse.json(
        { error: 'day_of_month is required for monthly frequency (1-31)' },
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

    // Calculate next_run_at
    const nextRunAt = calculateNextRunAt(frequency, time_of_day, timezone || 'UTC', day_of_week, day_of_month);

    // Upsert schedule
    const schedule = await db.queryOne(`
      INSERT INTO backup_schedules (
        business_id, user_id, is_enabled, frequency, time_of_day, timezone,
        day_of_week, day_of_month, storage_destination, retention_days,
        notification_email, next_run_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (business_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        is_enabled = EXCLUDED.is_enabled,
        frequency = EXCLUDED.frequency,
        time_of_day = EXCLUDED.time_of_day,
        timezone = EXCLUDED.timezone,
        day_of_week = EXCLUDED.day_of_week,
        day_of_month = EXCLUDED.day_of_month,
        storage_destination = EXCLUDED.storage_destination,
        retention_days = EXCLUDED.retention_days,
        notification_email = EXCLUDED.notification_email,
        next_run_at = EXCLUDED.next_run_at,
        updated_at = NOW()
      RETURNING *
    `, [
      business_id,
      user_id || null,
      is_enabled !== false, // Default to true
      frequency,
      time_of_day,
      timezone || 'UTC',
      day_of_week || null,
      day_of_month || null,
      storage_destination,
      retention_days || 30,
      notification_email || null,
      nextRunAt,
    ]);

    return NextResponse.json({
      success: true,
      schedule,
      message: 'Backup schedule saved successfully',
    });

  } catch (error: any) {
    console.error('Error saving backup schedule:', error);
    return NextResponse.json(
      { error: 'Failed to save backup schedule', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/backup/schedule
 * Delete backup schedule
 */
export async function DELETE(request: NextRequest) {
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

    await db.query(`
      DELETE FROM backup_schedules WHERE business_id = $1
    `, [businessId]);

    return NextResponse.json({
      success: true,
      message: 'Backup schedule deleted successfully',
    });

  } catch (error: any) {
    console.error('Error deleting backup schedule:', error);
    return NextResponse.json(
      { error: 'Failed to delete backup schedule', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Calculate next run timestamp based on schedule parameters
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
    // If time has passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
  } else if (frequency === 'weekly') {
    // Find next occurrence of day_of_week
    const currentDay = nextRun.getDay();
    const targetDay = dayOfWeek || 0;
    
    let daysUntilTarget = targetDay - currentDay;
    if (daysUntilTarget < 0 || (daysUntilTarget === 0 && nextRun <= now)) {
      daysUntilTarget += 7;
    }
    
    nextRun.setDate(nextRun.getDate() + daysUntilTarget);
  } else if (frequency === 'monthly') {
    // Set to specific day of month
    nextRun.setDate(dayOfMonth || 1);
    
    // If date has passed this month, move to next month
    if (nextRun <= now) {
      nextRun.setMonth(nextRun.getMonth() + 1);
    }
    
    // Handle months with fewer days
    if (nextRun.getDate() !== (dayOfMonth || 1)) {
      // Day doesn't exist in this month, use last day
      nextRun.setDate(0); // Go to last day of previous month
    }
  }

  return nextRun;
}
