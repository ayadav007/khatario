import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

/**
 * GET /api/settings/warehouses
 * Get warehouses_enabled setting for a business
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

    // First check if the column exists to avoid error logging
    const columnExists = await queryOne(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'business_settings' 
        AND column_name = 'warehouses_enabled'
      ) as exists
    `);

    // If column doesn't exist, return default without querying
    if (!columnExists || !columnExists.exists) {
      return NextResponse.json({ warehouses_enabled: false });
    }

    // Column exists, proceed with normal query
    let settings;
    try {
      settings = await queryOne(
        'SELECT warehouses_enabled FROM business_settings WHERE business_id = $1',
        [businessId]
      );

      // Create default settings if not exists
      if (!settings) {
        settings = await queryOne(`
          INSERT INTO business_settings (business_id, warehouses_enabled)
          VALUES ($1, $2)
          RETURNING warehouses_enabled
        `, [businessId, false]);
      }
    } catch (error: any) {
      // Log other errors but return default
      console.error('Error fetching warehouses setting:', error.message);
      return NextResponse.json({ warehouses_enabled: false });
    }

    // Also fetch auto_assign_branch_warehouses setting
    let autoAssignSetting = true; // Default to true for backward compatibility
    try {
      const autoAssignColumnExists = await queryOne(` 
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'business_settings' 
          AND column_name = 'auto_assign_branch_warehouses'
        ) as exists
      `);
      
      if (autoAssignColumnExists?.exists) {
        const autoAssign = await queryOne(
          'SELECT auto_assign_branch_warehouses FROM business_settings WHERE business_id = $1',
          [businessId]
        );
        autoAssignSetting = autoAssign?.auto_assign_branch_warehouses ?? true;
      }
    } catch (error) {
      // Ignore errors, use default
    }

    return NextResponse.json({ 
      warehouses_enabled: settings?.warehouses_enabled || false,
      auto_assign_branch_warehouses: autoAssignSetting
    });
  } catch (error: any) {
    console.error('Error fetching warehouses settings:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/warehouses
 * Update warehouses_enabled setting
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      warehouses_enabled,
      auto_assign_branch_warehouses
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // First check if the column exists to avoid error logging
    const columnExists = await queryOne(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'business_settings' 
        AND column_name = 'warehouses_enabled'
      ) as exists
    `);

    // If column doesn't exist, return error (migration needs to be run)
    if (!columnExists || !columnExists.exists) {
      console.error('[Warehouses Setting] Column warehouses_enabled does not exist in business_settings table');
      return NextResponse.json(
        { error: 'Database migration required. Please run migration 052_add_warehouses_enabled_setting.sql' },
        { status: 500 }
      );
    }

    // Column exists, proceed with update
    try {
      // Check if settings exist
      const existingSettings = await queryOne(
        'SELECT * FROM business_settings WHERE business_id = $1',
        [business_id]
      );

      let updatedSettings;

      // Check if auto_assign_branch_warehouses column exists
      const autoAssignColumnExists = await queryOne(` 
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'business_settings' 
          AND column_name = 'auto_assign_branch_warehouses'
        ) as exists
      `);

      if (existingSettings) {
        // Update existing settings
        if (autoAssignColumnExists?.exists && auto_assign_branch_warehouses !== undefined) {
          updatedSettings = await queryOne(`
            UPDATE business_settings
            SET warehouses_enabled = $1, 
                auto_assign_branch_warehouses = $2, 
                updated_at = CURRENT_TIMESTAMP
            WHERE business_id = $3
            RETURNING warehouses_enabled, auto_assign_branch_warehouses
          `, [warehouses_enabled === true, auto_assign_branch_warehouses === true, business_id]);
        } else {
          updatedSettings = await queryOne(`
            UPDATE business_settings
            SET warehouses_enabled = $1, updated_at = CURRENT_TIMESTAMP
            WHERE business_id = $2
            RETURNING warehouses_enabled
          `, [warehouses_enabled === true, business_id]);
        }
      } else {
        // Create new settings
        if (autoAssignColumnExists?.exists && auto_assign_branch_warehouses !== undefined) {
          updatedSettings = await queryOne(`
            INSERT INTO business_settings (business_id, warehouses_enabled, auto_assign_branch_warehouses)
            VALUES ($1, $2, $3)
            RETURNING warehouses_enabled, auto_assign_branch_warehouses
          `, [business_id, warehouses_enabled === true, auto_assign_branch_warehouses === true]);
        } else {
          updatedSettings = await queryOne(`
            INSERT INTO business_settings (business_id, warehouses_enabled)
            VALUES ($1, $2)
            RETURNING warehouses_enabled
          `, [business_id, warehouses_enabled === true]);
        }
      }

      if (!updatedSettings) {
        console.error('Failed to update warehouses setting: No result returned');
        return NextResponse.json(
          { error: 'Failed to update setting' },
          { status: 500 }
        );
      }

      console.log(`[Warehouses Setting] Updated for business ${business_id}: ${updatedSettings.warehouses_enabled}`);
      
      return NextResponse.json({ 
        warehouses_enabled: updatedSettings.warehouses_enabled === true,
        auto_assign_branch_warehouses: (updatedSettings as any).auto_assign_branch_warehouses ?? true
      });
    } catch (error: any) {
      console.error('Error updating warehouses setting:', error.message);
      return NextResponse.json(
        { error: 'Failed to update setting', details: error.message },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error updating warehouses settings:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

