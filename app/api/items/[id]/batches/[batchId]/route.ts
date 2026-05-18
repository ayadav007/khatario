import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';

/**
 * PATCH /api/items/[id]/batches/[batchId]
 * Update a batch
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; batchId: string } }
) {
  try {
    const { batchId } = params;
    const body = await request.json();
    const {
      business_id,
      batch_number,
      manufacturing_date,
      expiry_date,
      purchase_price,
      quantity,
      location_id,
      notes,
    } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify batch belongs to business
    const existing = await queryOne(
      `SELECT id FROM item_batches WHERE id = $1 AND business_id = $2`,
      [batchId, business_id]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Batch not found' },
        { status: 404 }
      );
    }

    const batch = await queryOne(
      `UPDATE item_batches
       SET batch_number = COALESCE($1, batch_number),
           manufacturing_date = COALESCE($2, manufacturing_date),
           expiry_date = COALESCE($3, expiry_date),
           purchase_price = COALESCE($4, purchase_price),
           quantity = COALESCE($5, quantity),
           location_id = COALESCE($6, location_id),
           notes = COALESCE($7, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND business_id = $9
       RETURNING *`,
      [
        batch_number,
        manufacturing_date,
        expiry_date,
        purchase_price,
        quantity,
        location_id,
        notes,
        batchId,
        business_id,
      ]
    );

    return NextResponse.json({ batch });
  } catch (error: any) {
    console.error('Error updating batch:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/items/[id]/batches/[batchId]
 * Delete a batch (only if quantity is 0)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; batchId: string } }
) {
  try {
    const { batchId } = params;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify batch belongs to business and quantity is 0
    const existing = await queryOne(
      `SELECT id, quantity FROM item_batches WHERE id = $1 AND business_id = $2`,
      [batchId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Batch not found' },
        { status: 404 }
      );
    }

    if (parseFloat(existing.quantity.toString()) > 0) {
      return NextResponse.json(
        { error: 'Cannot delete batch with quantity > 0' },
        { status: 400 }
      );
    }

    await query(
      `DELETE FROM item_batches WHERE id = $1 AND business_id = $2`,
      [batchId, businessId]
    );

    return NextResponse.json({ message: 'Batch deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting batch:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

