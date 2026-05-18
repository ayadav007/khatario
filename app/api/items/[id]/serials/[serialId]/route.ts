import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';

/**
 * PATCH /api/items/[id]/serials/[serialId]
 * Update serial number status or details
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; serialId: string } }
) {
  try {
    const { serialId } = params;
    const body = await request.json();
    const {
      business_id,
      status,
      location_id,
      notes,
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify serial belongs to business
    const existing = await queryOne(
      `SELECT id FROM item_serials WHERE id = $1 AND business_id = $2`,
      [serialId, business_id]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Serial number not found' },
        { status: 404 }
      );
    }

    const serial = await queryOne(
      `UPDATE item_serials
       SET status = COALESCE($1, status),
           location_id = COALESCE($2, location_id),
           notes = COALESCE($3, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND business_id = $5
       RETURNING *`,
      [status, location_id, notes, serialId, business_id]
    );

    return NextResponse.json({ serial });
  } catch (error: any) {
    console.error('Error updating serial:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/items/[id]/serials/[serialId]
 * Delete a serial number (only if status is not 'sold')
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; serialId: string } }
) {
  try {
    const { serialId } = params;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify serial belongs to business and is not sold
    const existing = await queryOne(
      `SELECT id, status FROM item_serials WHERE id = $1 AND business_id = $2`,
      [serialId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Serial number not found' },
        { status: 404 }
      );
    }

    if (existing.status === 'sold') {
      return NextResponse.json(
        { error: 'Cannot delete sold serial number' },
        { status: 400 }
      );
    }

    await query(
      `DELETE FROM item_serials WHERE id = $1 AND business_id = $2`,
      [serialId, businessId]
    );

    return NextResponse.json({ message: 'Serial number deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting serial:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

