import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertFeatureAccess } from '@/lib/subscription/feature-access';

// GET - List filter presets
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const entityType = searchParams.get('entity_type');

    if (!businessId || !entityType) {
      return NextResponse.json(
        { error: 'business_id and entity_type are required' },
        { status: 400 }
      );
    }

    // Check feature access
    await assertFeatureAccess(businessId, 'advanced_filters');

    // Get user from session (simplified - implement proper auth)
    const userId = request.headers.get('x-user-id');

    // Query presets
    const query = `
      SELECT 
        id,
        name,
        description,
        filters,
        is_public as "isPublic",
        is_default as "isDefault",
        created_at as "createdAt"
      FROM filter_presets
      WHERE business_id = $1 
        AND entity_type = $2
        AND (is_public = TRUE OR user_id = $3)
      ORDER BY is_default DESC, created_at DESC
    `;

    const presets = await db.queryRows(query, [businessId, entityType, userId]);

    return NextResponse.json({ presets });
  } catch (error: any) {
    console.error('Error fetching filter presets:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch filter presets' },
      { status: 500 }
    );
  }
}

// POST - Create filter preset
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      name,
      description,
      entity_type,
      filters,
      is_public,
      is_default,
    } = body;

    if (!business_id || !name || !entity_type || !filters) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check feature access
    await assertFeatureAccess(business_id, 'advanced_filters');

    // Get user from session (simplified - implement proper auth)
    const userId = request.headers.get('x-user-id') || 'system';

    // If setting as default, unset other defaults
    if (is_default) {
      await db.query(
        `UPDATE filter_presets 
         SET is_default = FALSE 
         WHERE business_id = $1 AND entity_type = $2 AND user_id = $3`,
        [business_id, entity_type, userId]
      );
    }

    // Insert preset
    const query = `
      INSERT INTO filter_presets (
        business_id,
        user_id,
        name,
        description,
        entity_type,
        filters,
        is_public,
        is_default
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING 
        id,
        name,
        description,
        filters,
        is_public as "isPublic",
        is_default as "isDefault",
        created_at as "createdAt"
    `;

    const result = await db.queryRows(query, [
      business_id,
      userId,
      name,
      description || null,
      entity_type,
      JSON.stringify(filters),
      is_public || false,
      is_default || false,
    ]);

    return NextResponse.json({ preset: result[0] }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating filter preset:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create filter preset' },
      { status: 500 }
    );
  }
}
