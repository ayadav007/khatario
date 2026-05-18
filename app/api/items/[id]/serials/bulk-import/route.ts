import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

/**
 * POST /api/items/[id]/serials/bulk-import
 * Bulk import serial numbers from CSV/text
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
      serials_text, // Newline-separated or comma-separated serial numbers
      purchase_price,
      location_id,
      supplier_id,
      purchase_id,
      batch_id,
      delimiter = '\n', // Default to newline, can be comma, semicolon, etc.
    } = body;

    if (!business_id || !serials_text || purchase_price === undefined) {
      return NextResponse.json(
        { error: 'business_id, serials_text, and purchase_price are required' },
        { status: 400 }
      );
    }

    // Parse serial numbers from text
    const serialNumbers = serials_text
      .split(delimiter)
      .map((s: string, _i: number) => s.trim())
      .filter((s: string, _i: number) => s.length > 0);

    if (serialNumbers.length === 0) {
      return NextResponse.json(
        { error: 'No valid serial numbers found in text' },
        { status: 400 }
      );
    }

    // Check for duplicates within the input itself
    const inputDuplicates = serialNumbers.filter((s: string, i: number) => serialNumbers.indexOf(s) !== i);
    if (inputDuplicates.length > 0) {
      const uniqueDuplicates = Array.from(new Set<string>(inputDuplicates));
      return NextResponse.json(
        { 
          error: 'Duplicate serial numbers found in input', 
          details: uniqueDuplicates.map(s => `Serial number "${s}" appears multiple times`)
        },
        { status: 400 }
      );
    }

    // Batch check for existing serial numbers (more efficient)
    const placeholders = serialNumbers.map((_: string, i: number) => `$${i + 3}`).join(', ');
    const existingCheck = await client.query(
      `SELECT serial_number FROM item_serials 
       WHERE item_id = $1 AND variant_id IS NOT DISTINCT FROM $2 
       AND serial_number IN (${placeholders})`,
      [itemId, variant_id || null, ...serialNumbers]
    );

    const existingSerials = new Set(existingCheck.rows.map((r: any) => r.serial_number));
    const duplicates = serialNumbers.filter((s: string) => existingSerials.has(s));

    if (duplicates.length > 0 && duplicates.length === serialNumbers.length) {
      return NextResponse.json(
        { 
          error: 'All serial numbers already exist', 
          details: duplicates.map((s: string) => `Serial number "${s}" already exists`)
        },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    const createdSerials: any[] = [];
    const errors: string[] = [];

    // Add existing serials to errors
    duplicates.forEach((s: string) => {
      errors.push(`Serial number "${s}" already exists`);
    });

    // Process only new serial numbers
    const newSerialNumbers = serialNumbers.filter((s: string) => !existingSerials.has(s));

    for (const serialNumber of newSerialNumbers) {

      try {
        const result = await client.query(
          `INSERT INTO item_serials (
            business_id, item_id, variant_id, serial_number,
            batch_id, purchase_price, location_id, supplier_id, purchase_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *`,
          [
            business_id,
            itemId,
            variant_id || null,
            serialNumber,
            batch_id || null,
            purchase_price,
            location_id || null,
            supplier_id || null,
            purchase_id || null,
          ]
        );

        createdSerials.push(result.rows[0]);
      } catch (err: any) {
        errors.push(`Failed to create serial ${serialNumber}: ${err.message}`);
      }
    }

    // Only rollback if no serials were created at all
    if (createdSerials.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { 
          error: 'Failed to import any serial numbers', 
          details: errors,
          duplicates: duplicates
        },
        { status: 400 }
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      serials: createdSerials,
      created: createdSerials.length,
      failed: errors.length,
      duplicates: duplicates.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully imported ${createdSerials.length} serial number(s).${errors.length > 0 ? ` ${errors.length} skipped (duplicates/errors).` : ''}`
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error bulk importing serials:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

