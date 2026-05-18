import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query, getPool } from '@/lib/db';

/**
 * GET /api/items/[id]/serials
 * List serial numbers for an item
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
    const status = searchParams.get('status');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        is.*,
        ib.batch_number,
        bl.name as location_name,
        s.name as supplier_name,
        c.name as customer_name,
        i.invoice_number
      FROM item_serials is
      LEFT JOIN item_batches ib ON is.batch_id = ib.id
      LEFT JOIN business_locations bl ON is.location_id = bl.id
      -- Soft delete: exclude records where deleted_at is set
      LEFT JOIN suppliers s ON is.supplier_id = s.id AND s.deleted_at IS NULL
      LEFT JOIN customers c ON is.sold_to_customer_id = c.id
      LEFT JOIN invoices i ON is.sold_invoice_id = i.id
      WHERE is.item_id = $1 AND is.business_id = $2
    `;
    const params_array: any[] = [itemId, businessId];

    if (locationId) {
      sql += ` AND is.location_id = $${params_array.length + 1}`;
      params_array.push(locationId);
    }

    if (status) {
      sql += ` AND is.status = $${params_array.length + 1}`;
      params_array.push(status);
    }

    sql += ` ORDER BY is.created_at DESC, is.serial_number ASC`;

    const serials = await queryRows(sql, params_array);

    return NextResponse.json({ serials });
  } catch (error: any) {
    console.error('Error fetching serials:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/items/[id]/serials
 * Create/add serial numbers (supports bulk import)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const itemId = params.id;
    const body = await request.json();
    const {
      business_id,
      variant_id,
      serials, // Array of { serial_number, batch_id?, purchase_price, location_id?, supplier_id?, purchase_id?, notes? }
    } = body;

    if (!business_id || !serials || !Array.isArray(serials) || serials.length === 0) {
      return NextResponse.json(
        { error: 'business_id and serials array are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    const createdSerials: any[] = [];
    const errors: string[] = [];

    for (const serialData of serials) {
      const {
        serial_number,
        batch_id,
        purchase_price,
        location_id,
        supplier_id,
        purchase_id,
        notes,
      } = serialData;

      if (!serial_number || purchase_price === undefined) {
        errors.push(`Serial number and purchase_price are required for all serials`);
        continue;
      }

      // Check if serial number already exists
      const existing = await client.query(
        `SELECT id FROM item_serials 
         WHERE item_id = $1 AND variant_id IS NOT DISTINCT FROM $2 
         AND serial_number = $3`,
        [itemId, variant_id || null, serial_number]
      );

      if (existing.rows.length > 0) {
        errors.push(`Serial number ${serial_number} already exists`);
        continue;
      }

      try {
        const result = await client.query(
          `INSERT INTO item_serials (
            business_id, item_id, variant_id, serial_number,
            batch_id, purchase_price, location_id, supplier_id, purchase_id, notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            business_id,
            itemId,
            variant_id || null,
            serial_number,
            batch_id || null,
            purchase_price,
            location_id || null,
            supplier_id || null,
            purchase_id || null,
            notes || null,
          ]
        );

        createdSerials.push(result.rows[0]);
      } catch (err: any) {
        errors.push(`Failed to create serial ${serial_number}: ${err.message}`);
      }
    }

    if (errors.length > 0 && createdSerials.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Failed to create serials', details: errors },
        { status: 400 }
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      serials: createdSerials,
      created: createdSerials.length,
      errors: errors.length > 0 ? errors : undefined,
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error creating serials:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

