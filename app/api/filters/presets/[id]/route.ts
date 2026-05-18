import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertFeatureAccess } from '@/lib/subscription/feature-access';

// DELETE - Delete filter preset
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Get preset to check business_id
    const preset = await db.queryRows(
      'SELECT business_id FROM filter_presets WHERE id = $1',
      [id]
    );

    if (!preset[0]) {
      return NextResponse.json(
        { error: 'Preset not found' },
        { status: 404 }
      );
    }

    // Check feature access
    await assertFeatureAccess(preset[0].business_id, 'advanced_filters');

    // Delete preset
    await db.query('DELETE FROM filter_presets WHERE id = $1', [id]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting filter preset:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete filter preset' },
      { status: 500 }
    );
  }
}

// PUT - Update filter preset
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();
    const { name, description, filters, is_public, is_default } = body;

    // Get preset to check business_id
    const preset = await db.queryRows(
      'SELECT business_id, entity_type, user_id FROM filter_presets WHERE id = $1',
      [id]
    );

    if (!preset[0]) {
      return NextResponse.json(
        { error: 'Preset not found' },
        { status: 404 }
      );
    }

    // Check feature access
    await assertFeatureAccess(preset[0].business_id, 'advanced_filters');

    // If setting as default, unset other defaults
    if (is_default) {
      await db.query(
        `UPDATE filter_presets 
         SET is_default = FALSE 
         WHERE business_id = $1 AND entity_type = $2 AND user_id = $3 AND id != $4`,
        [preset[0].business_id, preset[0].entity_type, preset[0].user_id, id]
      );
    }

    // Update preset
    const query = `
      UPDATE filter_presets
      SET 
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        filters = COALESCE($3, filters),
        is_public = COALESCE($4, is_public),
        is_default = COALESCE($5, is_default),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING 
        id,
        name,
        description,
        filters,
        is_public as "isPublic",
        is_default as "isDefault",
        updated_at as "updatedAt"
    `;

    const result = await db.queryRows(query, [
      name,
      description,
      filters ? JSON.stringify(filters) : null,
      is_public,
      is_default,
      id,
    ]);

    return NextResponse.json({ preset: result[0] });
  } catch (error: any) {
    console.error('Error updating filter preset:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update filter preset' },
      { status: 500 }
    );
  }
}
