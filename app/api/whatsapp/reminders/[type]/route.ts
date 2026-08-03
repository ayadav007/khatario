import { NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { hasFeature } from '@/lib/subscription';
import { FEATURE_PLAN_DENIED_RESPONSE_CODE } from '@/lib/subscription/feature-access';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

export const PATCH = withWhatsAppPremiumApi<{ type: string }>(
  { parseJsonBody: true },
  async ({ params, body, businessId }) => {
    try {
      const reminderType = params.type;

      if (!['payment_due', 'overdue'].includes(reminderType)) {
        return NextResponse.json(
          { error: 'Invalid reminder type. Must be "payment_due" or "overdue"' },
          { status: 400 },
        );
      }

      const { enabled, days_before, interval_days, message_template, include_pdf } = (body ??
        {}) as Record<string, unknown>;

      const hasAccess = await hasFeature(businessId, 'whatsapp_auto_reminders');
      if (!hasAccess) {
        return NextResponse.json(
          {
            error: 'Feature not available in your plan',
            code: FEATURE_PLAN_DENIED_RESPONSE_CODE,
            feature: 'whatsapp_auto_reminders',
          },
          { status: 403 },
        );
      }

      const updateFields: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (enabled !== undefined) {
        updateFields.push(`enabled = $${paramIndex++}`);
        values.push(enabled);
      }
      if (days_before !== undefined && reminderType === 'payment_due') {
        updateFields.push(`days_before = $${paramIndex++}`);
        values.push(days_before);
      }
      if (interval_days !== undefined && reminderType === 'overdue') {
        updateFields.push(`interval_days = $${paramIndex++}`);
        values.push(interval_days);
      }
      if (message_template !== undefined) {
        updateFields.push(`message_template = $${paramIndex++}`);
        values.push(message_template);
      }
      if (include_pdf !== undefined) {
        updateFields.push(`include_pdf = $${paramIndex++}`);
        values.push(include_pdf);
      }

      if (updateFields.length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      }

      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

      const existing = await db.queryOne(
        `SELECT id FROM whatsapp_reminder_settings WHERE business_id = $1 AND reminder_type = $2`,
        [businessId, reminderType],
      );

      if (existing) {
        values.push(businessId, reminderType);
        await db.query(
          `UPDATE whatsapp_reminder_settings 
         SET ${updateFields.join(', ')}
         WHERE business_id = $${paramIndex++} AND reminder_type = $${paramIndex++}`,
          values,
        );
      } else {
        const insertFields = ['business_id', 'reminder_type'];
        const insertValues: unknown[] = [businessId, reminderType];
        let insertParamIndex = 1;
        const insertPlaceholders: string[] = [`$${insertParamIndex++}`, `$${insertParamIndex++}`];

        if (enabled !== undefined) {
          insertFields.push('enabled');
          insertPlaceholders.push(`$${insertParamIndex++}`);
          insertValues.push(enabled);
        }
        if (days_before !== undefined && reminderType === 'payment_due') {
          insertFields.push('days_before');
          insertPlaceholders.push(`$${insertParamIndex++}`);
          insertValues.push(days_before);
        }
        if (interval_days !== undefined && reminderType === 'overdue') {
          insertFields.push('interval_days');
          insertPlaceholders.push(`$${insertParamIndex++}`);
          insertValues.push(interval_days);
        }
        if (message_template !== undefined) {
          insertFields.push('message_template');
          insertPlaceholders.push(`$${insertParamIndex++}`);
          insertValues.push(message_template);
        }
        if (include_pdf !== undefined) {
          insertFields.push('include_pdf');
          insertPlaceholders.push(`$${insertParamIndex++}`);
          insertValues.push(include_pdf);
        }

        await db.query(
          `INSERT INTO whatsapp_reminder_settings (${insertFields.join(', ')})
         VALUES (${insertPlaceholders.join(', ')})`,
          insertValues,
        );
      }

      const updated = await db.queryOne(
        `SELECT id, reminder_type, enabled, days_before, interval_days, message_template, include_pdf, created_at, updated_at
       FROM whatsapp_reminder_settings
       WHERE business_id = $1 AND reminder_type = $2`,
        [businessId, reminderType],
      );

      return NextResponse.json({ success: true, setting: updated });
    } catch (error: any) {
      console.error('Error updating reminder settings:', error);
      return NextResponse.json(
        { error: 'Failed to update reminder settings', details: error.message },
        { status: 500 },
      );
    }
  },
);

export const DELETE = withWhatsAppPremiumApi<{ type: string }>({}, async ({ params, businessId }) => {
  try {
    const reminderType = params.type;

    if (!['payment_due', 'overdue'].includes(reminderType)) {
      return NextResponse.json(
        { error: 'Invalid reminder type. Must be "payment_due" or "overdue"' },
        { status: 400 },
      );
    }

    await db.query(
      `UPDATE whatsapp_reminder_settings 
       SET enabled = false, updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND reminder_type = $2`,
      [businessId, reminderType],
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error disabling reminder:', error);
    return NextResponse.json(
      { error: 'Failed to disable reminder', details: error.message },
      { status: 500 },
    );
  }
});
