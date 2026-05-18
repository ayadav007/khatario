import { NextRequest, NextResponse } from 'next/server';
import { query as dbQuery, queryOne } from '@/lib/db';

/**
 * GET /api/suppliers/[id]/aliases
 * Get all aliases for a supplier
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = params.id;

    const aliases = await dbQuery(
      `SELECT * FROM supplier_name_aliases
       WHERE supplier_id = $1
       ORDER BY usage_count DESC, created_at DESC`,
      [supplierId]
    );

    return NextResponse.json({ aliases });

  } catch (error: any) {
    console.error('Error getting supplier aliases:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/suppliers/[id]/aliases
 * Create a new alias for a supplier
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = params.id;
    const body = await request.json();
    const { alias_name, alias_type = 'manual' } = body;

    if (!alias_name) {
      return NextResponse.json(
        { error: 'alias_name is required' },
        { status: 400 }
      );
    }

    // Check if supplier exists
    const supplier = await queryOne(
      `SELECT id FROM suppliers WHERE id = $1 AND deleted_at IS NULL`,
      [supplierId]
    );

    if (!supplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      );
    }

    // Check if alias already exists for this supplier
    const existing = await queryOne(
      `SELECT id FROM supplier_name_aliases
       WHERE supplier_id = $1 AND LOWER(alias_name) = LOWER($2)`,
      [supplierId, alias_name]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Alias already exists for this supplier' },
        { status: 409 }
      );
    }

    // Create alias
    const alias = await queryOne(
      `INSERT INTO supplier_name_aliases (
        supplier_id, alias_name, alias_type
      ) VALUES ($1, $2, $3)
      RETURNING *`,
      [supplierId, alias_name, alias_type]
    );

    return NextResponse.json({ alias }, { status: 201 });

  } catch (error: any) {
    console.error('Error creating supplier alias:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/suppliers/[id]/aliases?alias_id=xxx
 * Delete a supplier alias
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = params.id;
    const { searchParams } = new URL(request.url);
    const aliasId = searchParams.get('alias_id');

    if (!aliasId) {
      return NextResponse.json(
        { error: 'alias_id is required' },
        { status: 400 }
      );
    }

    // Delete alias
    await dbQuery(
      `DELETE FROM supplier_name_aliases
       WHERE id = $1 AND supplier_id = $2`,
      [aliasId, supplierId]
    );

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error deleting supplier alias:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
