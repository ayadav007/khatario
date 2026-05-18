import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { normalizePhone, isValidPhone } from '@/lib/utils/phone';

/**
 * GET /api/whatsapp/contacts
 * List all contacts for a business with pagination, search, and filters
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const search = searchParams.get('search') || '';
    const source = searchParams.get('source'); // manual, csv, group_extractor
    const groupId = searchParams.get('group_id'); // filter by group
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!businessId) {
      return NextResponse.json({ error: 'Business ID is required' }, { status: 400 });
    }

    // Check WhatsApp addon
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required' },
        { status: 403 }
      );
    }

    const pool = getPool();

    // Build query
    let query = `
      SELECT 
        c.*,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', g.id,
              'name', g.name,
              'color', g.color
            )
          ) FILTER (WHERE g.id IS NOT NULL),
          '[]'
        ) as groups
      FROM whatsapp_contacts c
      LEFT JOIN whatsapp_contact_group_members m ON c.id = m.contact_id
      LEFT JOIN whatsapp_contact_groups g ON m.group_id = g.id
      WHERE c.business_id = $1
    `;

    const params: any[] = [businessId];
    let paramIndex = 2;

    // Add search filter
    if (search) {
      query += ` AND (
        c.name ILIKE $${paramIndex} OR 
        c.phone ILIKE $${paramIndex} OR 
        c.email ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add source filter
    if (source) {
      query += ` AND c.source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }

    // Add group filter
    if (groupId) {
      query += ` AND EXISTS (
        SELECT 1 FROM whatsapp_contact_group_members 
        WHERE contact_id = c.id AND group_id = $${paramIndex}
      )`;
      params.push(groupId);
      paramIndex++;
    }

    // Add grouping, ordering, pagination
    query += `
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    // Get contacts
    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM whatsapp_contacts c
      WHERE c.business_id = $1
    `;
    const countParams: any[] = [businessId];
    let countParamIndex = 2;

    if (search) {
      countQuery += ` AND (
        c.name ILIKE $${countParamIndex} OR 
        c.phone ILIKE $${countParamIndex} OR 
        c.email ILIKE $${countParamIndex}
      )`;
      countParams.push(`%${search}%`);
      countParamIndex++;
    }

    if (source) {
      countQuery += ` AND c.source = $${countParamIndex}`;
      countParams.push(source);
      countParamIndex++;
    }

    if (groupId) {
      countQuery += ` AND EXISTS (
        SELECT 1 FROM whatsapp_contact_group_members 
        WHERE contact_id = c.id AND group_id = $${countParamIndex}
      )`;
      countParams.push(groupId);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || '0');

    return NextResponse.json({
      contacts: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error: any) {
    console.error('[Contacts API] GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch contacts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/whatsapp/contacts
 * Add a new contact (skip if duplicate)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, phone, name, email, tags, notes, custom_fields, source, imported_from_group } = body;

    if (!business_id || !phone) {
      return NextResponse.json(
        { error: 'Business ID and phone are required' },
        { status: 400 }
      );
    }

    // Check WhatsApp addon
    const hasAddon = await hasWhatsAppBotAddon(business_id);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required' },
        { status: 403 }
      );
    }

    // Normalize and validate phone
    const normalizedPhone = normalizePhone(phone);
    if (!isValidPhone(normalizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number' },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Check if contact already exists (skip if duplicate)
    const existingResult = await pool.query(
      'SELECT id FROM whatsapp_contacts WHERE business_id = $1 AND phone = $2',
      [business_id, normalizedPhone]
    );

    if (existingResult.rows.length > 0) {
      return NextResponse.json(
        { 
          error: 'Contact already exists',
          contact: existingResult.rows[0],
          skipped: true
        },
        { status: 409 }
      );
    }

    // Insert contact
    const result = await pool.query(
      `INSERT INTO whatsapp_contacts 
        (business_id, phone, name, email, tags, notes, custom_fields, source, imported_from_group)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        business_id,
        normalizedPhone,
        name || null,
        email || null,
        JSON.stringify(tags || []),
        notes || null,
        JSON.stringify(custom_fields || {}),
        source || 'manual',
        imported_from_group || null,
      ]
    );

    return NextResponse.json({
      contact: result.rows[0],
      message: 'Contact created successfully',
    }, { status: 201 });
  } catch (error: any) {
    console.error('[Contacts API] POST error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create contact' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/whatsapp/contacts
 * Update an existing contact
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, business_id, name, email, tags, notes, custom_fields } = body;

    if (!id || !business_id) {
      return NextResponse.json(
        { error: 'Contact ID and Business ID are required' },
        { status: 400 }
      );
    }

    // Check WhatsApp addon
    const hasAddon = await hasWhatsAppBotAddon(business_id);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required' },
        { status: 403 }
      );
    }

    const pool = getPool();

    // Verify contact belongs to business
    const checkResult = await pool.query(
      'SELECT id FROM whatsapp_contacts WHERE id = $1 AND business_id = $2',
      [id, business_id]
    );

    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Contact not found or access denied' },
        { status: 404 }
      );
    }

    // Update contact
    const result = await pool.query(
      `UPDATE whatsapp_contacts 
      SET 
        name = COALESCE($3, name),
        email = COALESCE($4, email),
        tags = COALESCE($5::jsonb, tags),
        notes = COALESCE($6, notes),
        custom_fields = COALESCE($7::jsonb, custom_fields)
      WHERE id = $1 AND business_id = $2
      RETURNING *`,
      [
        id,
        business_id,
        name,
        email,
        tags ? JSON.stringify(tags) : null,
        notes,
        custom_fields ? JSON.stringify(custom_fields) : null,
      ]
    );

    return NextResponse.json({
      contact: result.rows[0],
      message: 'Contact updated successfully',
    });
  } catch (error: any) {
    console.error('[Contacts API] PUT error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update contact' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/whatsapp/contacts
 * Delete a contact
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const businessId = searchParams.get('business_id');

    if (!id || !businessId) {
      return NextResponse.json(
        { error: 'Contact ID and Business ID are required' },
        { status: 400 }
      );
    }

    // Check WhatsApp addon
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required' },
        { status: 403 }
      );
    }

    const pool = getPool();

    // Delete contact (cascades to group memberships)
    const result = await pool.query(
      'DELETE FROM whatsapp_contacts WHERE id = $1 AND business_id = $2 RETURNING id',
      [id, businessId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Contact not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Contact deleted successfully',
    });
  } catch (error: any) {
    console.error('[Contacts API] DELETE error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete contact' },
      { status: 500 }
    );
  }
}
