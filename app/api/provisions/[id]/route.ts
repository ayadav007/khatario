import { NextRequest, NextResponse } from 'next/server';
import { getProvisionById } from '@/lib/services/provisions-manager';
import { getPool } from '@/lib/db';

/**
 * GET /api/provisions/[id]
 * Get provision by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const provision = await getProvisionById(params.id, businessId);

    if (!provision) {
      return NextResponse.json(
        { error: 'Provision not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ provision });
  } catch (error: any) {
    console.error('Error fetching provision:', error);
    return NextResponse.json(
      { error: 'Failed to fetch provision', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/provisions/[id]
 * Update provision
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { business_id, ...updates } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (updates.provision_name !== undefined) {
        updateFields.push(`provision_name = $${paramIndex++}`);
        updateValues.push(updates.provision_name);
      }
      if (updates.provision_type !== undefined) {
        updateFields.push(`provision_type = $${paramIndex++}`);
        updateValues.push(updates.provision_type);
      }
      if (updates.calculation_method !== undefined) {
        updateFields.push(`calculation_method = $${paramIndex++}`);
        updateValues.push(updates.calculation_method);
      }
      if (updates.calculation_rate !== undefined) {
        updateFields.push(`calculation_rate = $${paramIndex++}`);
        updateValues.push(updates.calculation_rate);
      }
      if (updates.description !== undefined) {
        updateFields.push(`description = $${paramIndex++}`);
        updateValues.push(updates.description);
      }
      if (updates.is_active !== undefined) {
        updateFields.push(`is_active = $${paramIndex++}`);
        updateValues.push(updates.is_active);
      }

      if (updateFields.length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      }

      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      updateValues.push(params.id, business_id);

      await client.query(
        `UPDATE provisions
         SET ${updateFields.join(', ')}
         WHERE id = $${paramIndex++} AND business_id = $${paramIndex++}`,
        updateValues
      );

      const provision = await getProvisionById(params.id, business_id);
      return NextResponse.json({ provision });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error updating provision:', error);
    return NextResponse.json(
      { error: 'Failed to update provision', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/provisions/[id]
 * Delete provision (soft delete by setting is_active = false)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query(
        `UPDATE provisions
         SET is_active = false, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND business_id = $2`,
        [params.id, businessId]
      );

      return NextResponse.json({ success: true });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error deleting provision:', error);
    return NextResponse.json(
      { error: 'Failed to delete provision', details: error.message },
      { status: 500 }
    );
  }
}

