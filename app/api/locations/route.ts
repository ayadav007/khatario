import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/locations
 * Fetch all locations for a business
 * Note: This endpoint is used for both branches and warehouses
 * It checks for either multi_branch OR multi_warehouse feature access
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

    // Check if user has either branch OR warehouse feature access
    // This allows the endpoint to work for both branches and warehouses
    let hasAccess = false;
    try {
      await assertFeatureAccess(businessId, 'multi_branch');
      hasAccess = true;
    } catch (error) {
      // If branch feature not available, check warehouse feature
      try {
        await assertFeatureAccess(businessId, 'multi_warehouse');
        hasAccess = true;
      } catch (warehouseError) {
        // Neither feature is available
        if (warehouseError instanceof FeatureAccessDeniedError) {
          return NextResponse.json(warehouseError.toResponse(), { status: 403 });
        }
        throw warehouseError;
      }
    }

    const locations = await db.queryRows(`
      SELECT * FROM business_locations
      WHERE business_id = $1
      ORDER BY is_primary DESC, name ASC
    `, [businessId]);

    return NextResponse.json({ locations });
  } catch (error: any) {
    console.error('Error fetching locations:', error);
    return NextResponse.json(
      { error: 'Failed to fetch locations', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/locations
 * Create a new location
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      name,
      location_code,
      is_primary,
      address_line1,
      address_line2,
      city,
      state,
      pincode,
      country,
      phone,
      email,
      gstin,
    } = body;

    if (!business_id || !name) {
      return NextResponse.json(
        { error: 'business_id and name are required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, 'multi_branch');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const location = await db.queryOne(`
      INSERT INTO business_locations (
        business_id, name, location_code, is_primary, address_line1, address_line2,
        city, state, pincode, country, phone, email, gstin
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      business_id, name, location_code, is_primary, address_line1, address_line2,
      city, state, pincode, country, phone, email, gstin
    ]);

    return NextResponse.json({ location }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating location:', error);
    return NextResponse.json(
      { error: 'Failed to create location', details: error.message },
      { status: 500 }
    );
  }
}

