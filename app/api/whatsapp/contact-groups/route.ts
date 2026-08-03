import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp/contact-groups
 * List all contact groups for a business
 */
export const GET = withWhatsAppPremiumApi({}, async ({ request, businessId, userId }) => {
  try {

    const pool = getPool();

    // Get groups with member counts
    const result = await pool.query(
      `SELECT 
        g.*,
        COUNT(m.contact_id) as member_count
      FROM whatsapp_contact_groups g
      LEFT JOIN whatsapp_contact_group_members m ON g.id = m.group_id
      WHERE g.business_id = $1
      GROUP BY g.id
      ORDER BY g.created_at DESC`,
      [businessId]
    );

    return NextResponse.json({
      groups: result.rows,
    });
  } catch (error: any) {
    console.error('[Contact Groups API] GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch contact groups' },
      { status: 500 }
    );
  }
});
/**
 * POST /api/whatsapp/contact-groups
 * Create a new contact group
 */
export const POST = withWhatsAppPremiumApi({ parseJsonBody: true }, async ({ request, businessId, body, userId }) => {
  try {
    const { name, description, color } = (body ?? {}) as Record<string, any>;

    if (!name) {
      return NextResponse.json(
        { error: 'Business ID and name are required' },
        { status: 400 }
      );
    }


    const pool = getPool();

    // Check if group with same name exists
    const existingResult = await pool.query(
      'SELECT id FROM whatsapp_contact_groups WHERE business_id = $1 AND name = $2',
      [businessId, name]
    );

    if (existingResult.rows.length > 0) {
      return NextResponse.json(
        { error: 'A group with this name already exists' },
        { status: 409 }
      );
    }

    // Create group
    const result = await pool.query(
      `INSERT INTO whatsapp_contact_groups (business_id, name, description, color)
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [businessId, name, description || null, color || '#25D366']
    );

    return NextResponse.json({
      group: result.rows[0],
      message: 'Contact group created successfully',
    }, { status: 201 });
  } catch (error: any) {
    console.error('[Contact Groups API] POST error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create contact group' },
      { status: 500 }
    );
  }
});

/**
 * PUT /api/whatsapp/contact-groups
 * Update an existing contact group
 */
export const PUT = withWhatsAppPremiumApi({ parseJsonBody: true }, async ({ request, businessId, body, userId }) => {
  try {
    const { id, name, description, color } = (body ?? {}) as Record<string, any>;

    if (!id) {
      return NextResponse.json(
        { error: 'Group ID and Business ID are required' },
        { status: 400 }
      );
    }


    const pool = getPool();

    // Verify group belongs to business
    const checkResult = await pool.query(
      'SELECT id FROM whatsapp_contact_groups WHERE id = $1 AND business_id = $2',
      [id, businessId]
    );

    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Group not found or access denied' },
        { status: 404 }
      );
    }

    // Check for name conflict if name is being changed
    if (name) {
      const conflictResult = await pool.query(
        'SELECT id FROM whatsapp_contact_groups WHERE business_id = $1 AND name = $2 AND id != $3',
        [businessId, name, id]
      );

      if (conflictResult.rows.length > 0) {
        return NextResponse.json(
          { error: 'A group with this name already exists' },
          { status: 409 }
        );
      }
    }

    // Update group
    const result = await pool.query(
      `UPDATE whatsapp_contact_groups 
      SET 
        name = COALESCE($3, name),
        description = COALESCE($4, description),
        color = COALESCE($5, color)
      WHERE id = $1 AND business_id = $2
      RETURNING *`,
      [id, businessId, name, description, color]
    );

    return NextResponse.json({
      group: result.rows[0],
      message: 'Contact group updated successfully',
    });
  } catch (error: any) {
    console.error('[Contact Groups API] PUT error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update contact group' },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/whatsapp/contact-groups
 * Delete a contact group
 */
export const DELETE = withWhatsAppPremiumApi({}, async ({ request, businessId, userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id || !businessId) {
      return NextResponse.json(
        { error: 'Group ID and Business ID are required' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Delete group (cascades to memberships)
    const result = await pool.query(
      'DELETE FROM whatsapp_contact_groups WHERE id = $1 AND business_id = $2 RETURNING id',
      [id, businessId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Group not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Contact group deleted successfully',
    });
  } catch (error: any) {
    console.error('[Contact Groups API] DELETE error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete contact group' },
      { status: 500 }
    );
  }
});
