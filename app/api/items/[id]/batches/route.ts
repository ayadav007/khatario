import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query, getPool } from '@/lib/db';

/**
 * GET /api/items/[id]/batches
 * List batches for an item
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const locationId = searchParams.get('location_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        ib.*,
        bl.name as location_name,
        s.name as supplier_name,
        p.bill_number as purchase_bill_number
      FROM item_batches ib
      LEFT JOIN business_locations bl ON ib.location_id = bl.id
      -- Soft delete: exclude records where deleted_at is set
      LEFT JOIN suppliers s ON ib.supplier_id = s.id AND s.deleted_at IS NULL
      LEFT JOIN purchases p ON ib.purchase_id = p.id
      WHERE ib.item_id = $1 AND ib.business_id = $2
    `;
    const params_array: any[] = [itemId, businessId];

    if (locationId) {
      sql += ` AND ib.location_id = $3`;
      params_array.push(locationId);
    }

    sql += ` ORDER BY ib.created_at DESC, ib.batch_number ASC`;

    const batches = await queryRows(sql, params_array);

    return NextResponse.json({ batches });
  } catch (error: any) {
    console.error('Error fetching batches:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/items/[id]/batches
 * Create a new batch
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const itemId = params.id;
    const body = await request.json();
    const {
      business_id,
      variant_id,
      batch_number,
      manufacturing_date,
      expiry_date,
      purchase_price,
      quantity,
      location_id,
      supplier_id,
      purchase_id,
      notes,
    } = body;

    if (!business_id || !batch_number || !purchase_price || quantity === undefined) {
      return NextResponse.json(
        { error: 'business_id, batch_number, purchase_price, and quantity are required' },
        { status: 400 }
      );
    }

    // Check if batch number already exists for this item
    const existing = await queryOne(
      `SELECT id FROM item_batches 
       WHERE item_id = $1 AND variant_id IS NOT DISTINCT FROM $2 
       AND batch_number = $3 AND location_id IS NOT DISTINCT FROM $4`,
      [itemId, variant_id || null, batch_number, location_id || null]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Batch number already exists for this item' },
        { status: 400 }
      );
    }

    const batch = await queryOne(
      `INSERT INTO item_batches (
        business_id, item_id, variant_id, batch_number,
        manufacturing_date, expiry_date, purchase_price, quantity,
        location_id, supplier_id, purchase_id, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        business_id,
        itemId,
        variant_id || null,
        batch_number,
        manufacturing_date || null,
        expiry_date || null,
        purchase_price,
        quantity,
        location_id || null,
        supplier_id || null,
        purchase_id || null,
        notes || null,
      ]
    );

    return NextResponse.json({ batch }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating batch:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

