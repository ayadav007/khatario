/**
 * API endpoint for managing individual labels
 * PATCH - Update label
 * DELETE - Delete label
 */

import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const labelId = params.id;
    const body = await request.json();
    const { business_id, name, color } = body;

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Verify label belongs to business
    const label = await queryOne(
      `SELECT id FROM whatsapp_conversation_labels WHERE id = $1 AND business_id = $2`,
      [labelId, business_id]
    );

    if (!label) {
      return NextResponse.json({ error: 'Label not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name.trim());
    }

    if (color !== undefined) {
      // Validate color format
      const colorRegex = /^#[0-9A-F]{6}$/i;
      if (!colorRegex.test(color)) {
        return NextResponse.json({ error: 'Invalid color format. Use hex format like #25D366' }, { status: 400 });
      }
      updates.push(`color = $${paramIndex++}`);
      values.push(color);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(labelId, business_id);

    const result = await queryOne(
      `UPDATE whatsapp_conversation_labels 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex++} AND business_id = $${paramIndex++}
       RETURNING *`,
      values
    );

    return NextResponse.json({ label: result });
  } catch (error: any) {
    console.error('Error updating label:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const labelId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Verify label belongs to business
    const label = await queryOne(
      `SELECT id FROM whatsapp_conversation_labels WHERE id = $1 AND business_id = $2`,
      [labelId, businessId]
    );

    if (!label) {
      return NextResponse.json({ error: 'Label not found' }, { status: 404 });
    }

    // Delete label (CASCADE will remove assignments)
    await query(
      `DELETE FROM whatsapp_conversation_labels WHERE id = $1 AND business_id = $2`,
      [labelId, businessId]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting label:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

