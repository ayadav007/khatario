import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

/**
 * GET /api/settings/user-management
 * Get user management settings
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

    let settings = await queryOne(
      'SELECT * FROM business_settings WHERE business_id = $1',
      [businessId]
    );

    // Create default settings if not exists
    if (!settings) {
      settings = await queryOne(`
        INSERT INTO business_settings (business_id, user_management_enabled)
        VALUES ($1, false)
        RETURNING *
      `, [businessId]);
    }

    return NextResponse.json({ settings });
  } catch (error: any) {
    console.error('Error fetching user management settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/user-management
 * Update user management settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      user_management_enabled,
      session_timeout_minutes,
      max_failed_login_attempts,
      updated_by_user_id
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Check if settings exist
    const existingSettings = await queryOne(
      'SELECT * FROM business_settings WHERE business_id = $1',
      [business_id]
    );

    let updatedSettings;

    if (existingSettings) {
      // Update existing settings
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (user_management_enabled !== undefined) {
        updates.push(`user_management_enabled = $${paramIndex++}`);
        values.push(user_management_enabled);
      }
      if (session_timeout_minutes !== undefined) {
        updates.push(`session_timeout_minutes = $${paramIndex++}`);
        values.push(session_timeout_minutes);
      }
      if (max_failed_login_attempts !== undefined) {
        updates.push(`max_failed_login_attempts = $${paramIndex++}`);
        values.push(max_failed_login_attempts);
      }

      if (updates.length === 0) {
        return NextResponse.json(
          { error: 'No fields to update' },
          { status: 400 }
        );
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(business_id);

      updatedSettings = await queryOne(`
        UPDATE business_settings
        SET ${updates.join(', ')}
        WHERE business_id = $${paramIndex}
        RETURNING *
      `, values);
    } else {
      // Create new settings
      updatedSettings = await queryOne(`
        INSERT INTO business_settings (
          business_id, 
          user_management_enabled, 
          session_timeout_minutes, 
          max_failed_login_attempts
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        business_id,
        user_management_enabled ?? false,
        session_timeout_minutes ?? 30,
        max_failed_login_attempts ?? 5
      ]);
    }

    // Log activity
    if (updated_by_user_id) {
      const updater = await queryOne('SELECT name FROM users WHERE id = $1', [updated_by_user_id]);
      await query(`
        INSERT INTO user_activity_logs (
          business_id, user_id, user_name, action, module, entity_type, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        business_id,
        updated_by_user_id,
        updater?.name || 'Unknown',
        'update_user_management_settings',
        'settings',
        'settings',
        JSON.stringify({ user_management_enabled })
      ]);
    }

    return NextResponse.json({
      success: true,
      settings: updatedSettings,
      message: 'Settings updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating user management settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings', details: error.message },
      { status: 500 }
    );
  }
}

