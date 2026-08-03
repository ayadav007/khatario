import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp/contact-groups/[id]/members
 * Get all members of a contact group
 */
export const GET = withWhatsAppPremiumApi<{ id: string }>({}, async ({ params, request, businessId, userId }) => {
  try {
    const groupId = params.id;

    const pool = getPool();

    // Verify group belongs to business
    const groupResult = await pool.query(
      'SELECT id FROM whatsapp_contact_groups WHERE id = $1 AND business_id = $2',
      [groupId, businessId]
    );

    if (groupResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Group not found or access denied' },
        { status: 404 }
      );
    }

    // Get members with contact details
    const result = await pool.query(
      `SELECT 
        c.*,
        m.added_at
      FROM whatsapp_contact_group_members m
      JOIN whatsapp_contacts c ON m.contact_id = c.id
      WHERE m.group_id = $1
      ORDER BY m.added_at DESC`,
      [groupId]
    );

    return NextResponse.json({
      members: result.rows,
      total: result.rows.length,
    });
  } catch (error: any) {
    console.error('[Contact Group Members API] GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch group members' },
      { status: 500 }
    );
  }
});
/**
 * POST /api/whatsapp/contact-groups/[id]/members
 * Add contacts to a group (bulk)
 */
export const POST = withWhatsAppPremiumApi<{ id: string }>({ parseJsonBody: true }, async ({ params, request, businessId, body, userId }) => {
  try {
    const groupId = params.id;
    const { contact_ids } = (body ?? {}) as Record<string, any>;

    if (!contact_ids || !Array.isArray(contact_ids)) {
      return NextResponse.json(
        { error: 'Business ID and contact_ids array are required' },
        { status: 400 }
      );
    }


    const pool = getPool();

    // Verify group belongs to business
    const groupResult = await pool.query(
      'SELECT id FROM whatsapp_contact_groups WHERE id = $1 AND business_id = $2',
      [groupId, businessId]
    );

    if (groupResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Group not found or access denied' },
        { status: 404 }
      );
    }

    // Add contacts to group (skip duplicates)
    let added = 0;
    let skipped = 0;

    for (const contactId of contact_ids) {
      try {
        // Verify contact belongs to business
        const contactResult = await pool.query(
          'SELECT id FROM whatsapp_contacts WHERE id = $1 AND business_id = $2',
          [contactId, businessId]
        );

        if (contactResult.rows.length === 0) {
          skipped++;
          continue;
        }

        // Add to group (ignore if already exists)
        const result = await pool.query(
          `INSERT INTO whatsapp_contact_group_members (group_id, contact_id)
          VALUES ($1, $2)
          ON CONFLICT (group_id, contact_id) DO NOTHING
          RETURNING id`,
          [groupId, contactId]
        );

        if (result.rows.length > 0) {
          added++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error('[Contact Group Members API] Error adding contact:', error);
        skipped++;
      }
    }

    return NextResponse.json({
      message: `Added ${added} contacts, skipped ${skipped}`,
      added,
      skipped,
      total: contact_ids.length,
    });
  } catch (error: any) {
    console.error('[Contact Group Members API] POST error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to add contacts to group' },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/whatsapp/contact-groups/[id]/members
 * Remove contacts from a group
 */
export const DELETE = withWhatsAppPremiumApi<{ id: string }>({}, async ({ params, request, businessId, userId }) => {
  try {
    const groupId = params.id;
    const { searchParams } = new URL(request.url);
    const contactIds = searchParams.get('contact_ids')?.split(',') || [];

    if (!businessId || contactIds.length === 0) {
      return NextResponse.json(
        { error: 'Business ID and contact_ids are required' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Verify group belongs to business
    const groupResult = await pool.query(
      'SELECT id FROM whatsapp_contact_groups WHERE id = $1 AND business_id = $2',
      [groupId, businessId]
    );

    if (groupResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Group not found or access denied' },
        { status: 404 }
      );
    }

    // Remove contacts from group
    const result = await pool.query(
      `DELETE FROM whatsapp_contact_group_members 
      WHERE group_id = $1 AND contact_id = ANY($2)
      RETURNING id`,
      [groupId, contactIds]
    );

    return NextResponse.json({
      message: `Removed ${result.rows.length} contacts from group`,
      removed: result.rows.length,
    });
  } catch (error: any) {
    console.error('[Contact Group Members API] DELETE error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to remove contacts from group' },
      { status: 500 }
    );
  }
});
