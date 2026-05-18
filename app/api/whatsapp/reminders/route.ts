import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { hasFeature } from '@/lib/subscription';
import {
  isValidIanaTimeZone,
  parseReminderTimeToSql,
  reminderTimeToHhMm,
} from '@/lib/reminder-schedule';
import { FEATURE_PLAN_DENIED_RESPONSE_CODE } from '@/lib/subscription/feature-access';

/**
 * GET /api/whatsapp/reminders?business_id=xxx
 * Fetch reminder settings for a business (both payment_due and overdue)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Fetch both reminder types
    const settings = await db.queryRows(
      `SELECT id, reminder_type, enabled, days_before, interval_days, message_template, include_pdf, created_at, updated_at
       FROM whatsapp_reminder_settings
       WHERE business_id = $1
       ORDER BY reminder_type`,
      [businessId]
    );

    // Convert to object with reminder_type as key
    const result: any = {
      payment_due: null,
      overdue: null
    };

    for (const setting of settings) {
      result[setting.reminder_type] = setting;
    }

    const scheduleRow = await db.queryOne<{
      reminder_send_time: unknown;
      reminder_send_timezone: string | null;
    }>(
      `SELECT reminder_send_time, reminder_send_timezone
       FROM business_settings
       WHERE business_id = $1`,
      [businessId]
    );

    const schedule = {
      reminder_send_time: reminderTimeToHhMm(scheduleRow?.reminder_send_time),
      reminder_send_timezone: (scheduleRow?.reminder_send_timezone || 'Asia/Kolkata').trim() || 'Asia/Kolkata',
    };

    return NextResponse.json({ settings: result, schedule });
  } catch (error: any) {
    console.error('Error fetching reminder settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reminder settings', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/reminders
 * Create or update reminder settings for both types
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, payment_due, overdue, schedule } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Check subscription feature (schedule + auto reminder types use the same feature)
    const hasAccess = await hasFeature(business_id, 'whatsapp_auto_reminders');
    if (!hasAccess) {
      return NextResponse.json(
        {
          error: 'Feature not available in your plan',
          code: FEATURE_PLAN_DENIED_RESPONSE_CODE,
          feature: 'whatsapp_auto_reminders',
        },
        { status: 403 }
      );
    }

    const results: Record<string, unknown> = {};

    if (schedule !== undefined) {
      const rawTz = typeof schedule?.reminder_send_timezone === 'string' ? schedule.reminder_send_timezone : 'Asia/Kolkata';
      const timeInput =
        typeof schedule?.reminder_send_time === 'string' ? schedule.reminder_send_time : '09:00';
      const tz = rawTz.trim() || 'Asia/Kolkata';
      if (!isValidIanaTimeZone(tz)) {
        return NextResponse.json(
          { error: 'Invalid time zone. Use a valid IANA name (e.g. Asia/Kolkata).' },
          { status: 400 }
        );
      }
      const sqlTime = parseReminderTimeToSql(timeInput);
      await db.query(
        `INSERT INTO business_settings (business_id, reminder_send_time, reminder_send_timezone)
         VALUES ($1, $2::time, $3)
         ON CONFLICT (business_id) DO UPDATE
         SET reminder_send_time = EXCLUDED.reminder_send_time,
             reminder_send_timezone = EXCLUDED.reminder_send_timezone,
             updated_at = CURRENT_TIMESTAMP`,
        [business_id, sqlTime, tz]
      );
      results.schedule = {
        reminder_send_time: reminderTimeToHhMm(sqlTime),
        reminder_send_timezone: tz,
      };
    }

    // Upsert payment_due settings
    if (payment_due !== undefined) {
      const { enabled, days_before, message_template, include_pdf } = payment_due;
      const includePdf = include_pdf !== false;

      // Check if exists
      const existing = await db.queryOne(
        `SELECT id FROM whatsapp_reminder_settings WHERE business_id = $1 AND reminder_type = 'payment_due'`,
        [business_id]
      );

      if (existing) {
        await db.query(
          `UPDATE whatsapp_reminder_settings
           SET enabled = $1, days_before = $2, message_template = $3, include_pdf = $4, updated_at = CURRENT_TIMESTAMP
           WHERE business_id = $5 AND reminder_type = 'payment_due'`,
          [enabled || false, days_before || null, message_template || null, includePdf, business_id]
        );
      } else {
        await db.query(
          `INSERT INTO whatsapp_reminder_settings (business_id, reminder_type, enabled, days_before, message_template, include_pdf)
           VALUES ($1, 'payment_due', $2, $3, $4, $5)`,
          [business_id, enabled || false, days_before || null, message_template || null, includePdf]
        );
      }

      results.payment_due = { enabled, days_before, message_template, include_pdf: includePdf };
    }

    // Upsert overdue settings
    if (overdue !== undefined) {
      const { enabled, interval_days, message_template, include_pdf } = overdue;
      const includePdf = include_pdf !== false;

      // Check if exists
      const existing = await db.queryOne(
        `SELECT id FROM whatsapp_reminder_settings WHERE business_id = $1 AND reminder_type = 'overdue'`,
        [business_id]
      );

      if (existing) {
        await db.query(
          `UPDATE whatsapp_reminder_settings
           SET enabled = $1, interval_days = $2, message_template = $3, include_pdf = $4, updated_at = CURRENT_TIMESTAMP
           WHERE business_id = $5 AND reminder_type = 'overdue'`,
          [enabled || false, interval_days || null, message_template || null, includePdf, business_id]
        );
      } else {
        await db.query(
          `INSERT INTO whatsapp_reminder_settings (business_id, reminder_type, enabled, interval_days, message_template, include_pdf)
           VALUES ($1, 'overdue', $2, $3, $4, $5)`,
          [business_id, enabled || false, interval_days || null, message_template || null, includePdf]
        );
      }

      results.overdue = { enabled, interval_days, message_template, include_pdf: includePdf };
    }

    if (
      results.payment_due === undefined &&
      results.overdue === undefined &&
      results.schedule === undefined
    ) {
      return NextResponse.json(
        { error: 'Nothing to save: provide payment_due, overdue, and/or schedule' },
        { status: 400 }
      );
    }

    const payload: {
      success: boolean;
      settings?: { payment_due?: unknown; overdue?: unknown };
      schedule?: unknown;
    } = { success: true };
    if (results.payment_due !== undefined || results.overdue !== undefined) {
      payload.settings = {};
      if (results.payment_due !== undefined) payload.settings.payment_due = results.payment_due;
      if (results.overdue !== undefined) payload.settings.overdue = results.overdue;
    }
    if (results.schedule !== undefined) payload.schedule = results.schedule;
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('Error saving reminder settings:', error);
    return NextResponse.json(
      { error: 'Failed to save reminder settings', details: error.message },
      { status: 500 }
    );
  }
}

