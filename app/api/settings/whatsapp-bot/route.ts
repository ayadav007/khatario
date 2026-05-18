import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * GET /api/settings/whatsapp-bot
 * Get WhatsApp bot typing indicator settings for a business
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

    // First check if the columns exist to avoid error logging
    const columnsExist = await queryOne(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'business_settings' 
        AND column_name = 'whatsapp_bot_typing_enabled'
      ) as exists
    `);

    // If columns don't exist, return defaults without querying
    if (!columnsExist || !columnsExist.exists) {
      return NextResponse.json({ 
        whatsapp_bot_typing_enabled: false,
        whatsapp_bot_typing_delay_seconds: 3
      });
    }

    // Columns exist, proceed with normal query
    let settings;
    try {
      settings = await queryOne(
        'SELECT whatsapp_bot_typing_enabled, whatsapp_bot_typing_delay_seconds FROM business_settings WHERE business_id = $1',
        [businessId]
      );

      // Create default settings if not exists
      if (!settings) {
        settings = await queryOne(`
          INSERT INTO business_settings (business_id, whatsapp_bot_typing_enabled, whatsapp_bot_typing_delay_seconds)
          VALUES ($1, $2, $3)
          RETURNING whatsapp_bot_typing_enabled, whatsapp_bot_typing_delay_seconds
        `, [businessId, false, 3]);
      }
    } catch (error: any) {
      // Log other errors but return default
      console.error('Error fetching WhatsApp bot typing settings:', error.message);
      return NextResponse.json({ 
        whatsapp_bot_typing_enabled: false,
        whatsapp_bot_typing_delay_seconds: 3
      });
    }

    return NextResponse.json({ 
      whatsapp_bot_typing_enabled: settings?.whatsapp_bot_typing_enabled || false,
      whatsapp_bot_typing_delay_seconds: settings?.whatsapp_bot_typing_delay_seconds || 3
    });
  } catch (error: any) {
    console.error('Error fetching WhatsApp bot typing settings:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/whatsapp-bot
 * Update WhatsApp bot typing indicator settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      whatsapp_bot_typing_enabled,
      whatsapp_bot_typing_delay_seconds
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Validate delay_seconds if provided (1-10 seconds)
    if (whatsapp_bot_typing_delay_seconds !== undefined) {
      const delay = parseInt(whatsapp_bot_typing_delay_seconds);
      if (isNaN(delay) || delay < 1 || delay > 10) {
        return NextResponse.json(
          { error: 'whatsapp_bot_typing_delay_seconds must be between 1 and 10' },
          { status: 400 }
        );
      }
    }

    // First check if the columns exist to avoid error logging
    const columnsExist = await queryOne(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'business_settings' 
        AND column_name = 'whatsapp_bot_typing_enabled'
      ) as exists
    `);

    // If columns don't exist, return error
    if (!columnsExist || !columnsExist.exists) {
      return NextResponse.json(
        { error: 'Settings columns not found. Please run database migration.' },
        { status: 500 }
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

      if (whatsapp_bot_typing_enabled !== undefined) {
        updates.push(`whatsapp_bot_typing_enabled = $${paramIndex++}`);
        values.push(whatsapp_bot_typing_enabled);
      }
      if (whatsapp_bot_typing_delay_seconds !== undefined) {
        updates.push(`whatsapp_bot_typing_delay_seconds = $${paramIndex++}`);
        values.push(parseInt(whatsapp_bot_typing_delay_seconds));
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
        RETURNING whatsapp_bot_typing_enabled, whatsapp_bot_typing_delay_seconds
      `, values);
    } else {
      // Create new settings
      updatedSettings = await queryOne(`
        INSERT INTO business_settings (
          business_id, 
          whatsapp_bot_typing_enabled, 
          whatsapp_bot_typing_delay_seconds
        )
        VALUES ($1, $2, $3)
        RETURNING whatsapp_bot_typing_enabled, whatsapp_bot_typing_delay_seconds
      `, [
        business_id,
        whatsapp_bot_typing_enabled !== undefined ? whatsapp_bot_typing_enabled : false,
        whatsapp_bot_typing_delay_seconds !== undefined ? parseInt(whatsapp_bot_typing_delay_seconds) : 3
      ]);
    }

    return NextResponse.json({ 
      whatsapp_bot_typing_enabled: updatedSettings?.whatsapp_bot_typing_enabled || false,
      whatsapp_bot_typing_delay_seconds: updatedSettings?.whatsapp_bot_typing_delay_seconds || 3
    });
  } catch (error: any) {
    console.error('Error updating WhatsApp bot typing settings:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
