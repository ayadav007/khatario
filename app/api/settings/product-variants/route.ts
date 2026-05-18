import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

/**
 * GET /api/settings/product-variants
 * Get product variants setting for a business
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
      'SELECT product_variants_enabled FROM business_settings WHERE business_id = $1',
      [businessId]
    );

    // Create default settings if not exists
    if (!settings) {
      // Check business industry to auto-enable if textiles/garments
      const business = await queryOne(
        'SELECT industry FROM businesses WHERE id = $1',
        [businessId]
      );
      
      const productVariantsEnabled = business?.industry === 'textiles' || business?.industry === 'garments';
      
      settings = await queryOne(`
        INSERT INTO business_settings (business_id, product_variants_enabled)
        VALUES ($1, $2)
        RETURNING product_variants_enabled
      `, [businessId, productVariantsEnabled]);
    }

    return NextResponse.json({ 
      product_variants_enabled: settings?.product_variants_enabled || false 
    });
  } catch (error: any) {
    console.error('Error fetching product variants settings:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/product-variants
 * Update product variants setting
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      product_variants_enabled,
      updated_by_user_id
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Check business industry
    const business = await queryOne(
      'SELECT industry FROM businesses WHERE id = $1',
      [business_id]
    );

    // Validate: Only allow enable if industry is textiles/garments (or allow manual override)
    // For now, we allow manual override but show warning in UI
    if (product_variants_enabled === true && 
        business?.industry !== 'textiles' && 
        business?.industry !== 'garments') {
      // Allow but could add warning in response
    }

    // Check if settings exist
    const existingSettings = await queryOne(
      'SELECT * FROM business_settings WHERE business_id = $1',
      [business_id]
    );

    let updatedSettings;

    if (existingSettings) {
      // Update existing settings
      updatedSettings = await queryOne(`
        UPDATE business_settings
        SET product_variants_enabled = $1, updated_at = CURRENT_TIMESTAMP
        WHERE business_id = $2
        RETURNING product_variants_enabled
      `, [product_variants_enabled, business_id]);
    } else {
      // Create new settings
      updatedSettings = await queryOne(`
        INSERT INTO business_settings (business_id, product_variants_enabled)
        VALUES ($1, $2)
        RETURNING product_variants_enabled
      `, [business_id, product_variants_enabled || false]);
    }

    return NextResponse.json({ 
      product_variants_enabled: updatedSettings?.product_variants_enabled || false,
      warning: (product_variants_enabled === true && 
                business?.industry !== 'textiles' && 
                business?.industry !== 'garments') 
        ? 'Product variants are typically used for textiles/garments industry' 
        : undefined
    });
  } catch (error: any) {
    console.error('Error updating product variants settings:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

