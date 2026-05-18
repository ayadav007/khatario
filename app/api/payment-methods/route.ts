import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';

/**
 * GET /api/payment-methods
 * List payment methods for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const methods = await queryRows(`
      SELECT * FROM payment_methods 
      WHERE business_id = $1 
      ORDER BY priority ASC, created_at DESC
    `, [businessId]);

    return NextResponse.json({ methods });
  } catch (error: any) {
    console.error('Error fetching payment methods:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/payment-methods
 * Add a new payment method
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      method_type,
      method_name,
      upi_id,
      bank_account_id,
      wallet_provider,
      account_details,
      is_active = true,
      is_default = false,
      priority = 0,
      notes
    } = body;

    if (!business_id || !method_type || !method_name) {
      return NextResponse.json(
        { error: 'business_id, method_type, and method_name are required' },
        { status: 400 }
      );
    }

    // If setting as default, unset other defaults for this business
    if (is_default) {
      await query(
        'UPDATE payment_methods SET is_default = false WHERE business_id = $1',
        [business_id]
      );
    }

    const method = await queryOne(
      `INSERT INTO payment_methods (
        business_id, method_type, method_name, upi_id, bank_account_id,
        wallet_provider, account_details, is_active, is_default, priority, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        business_id,
        method_type,
        method_name,
        upi_id || null,
        bank_account_id || null,
        wallet_provider || null,
        account_details || '{}',
        is_active,
        is_default,
        priority,
        notes || null
      ]
    );

    return NextResponse.json({ method }, { status: 201 });
  } catch (error: any) {
    console.error('Error adding payment method:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/payment-methods
 * Update an existing payment method
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      id,
      business_id,
      method_type,
      method_name,
      upi_id,
      bank_account_id,
      wallet_provider,
      account_details,
      is_active,
      is_default,
      priority,
      notes
    } = body;

    if (!id || !business_id) {
      return NextResponse.json(
        { error: 'id and business_id are required' },
        { status: 400 }
      );
    }

    // If setting as default, unset other defaults for this business
    if (is_default) {
      await query(
        'UPDATE payment_methods SET is_default = false WHERE business_id = $1 AND id != $2',
        [business_id, id]
      );
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (method_type !== undefined) {
      updates.push(`method_type = $${paramIndex++}`);
      values.push(method_type);
    }
    if (method_name !== undefined) {
      updates.push(`method_name = $${paramIndex++}`);
      values.push(method_name);
    }
    if (upi_id !== undefined) {
      updates.push(`upi_id = $${paramIndex++}`);
      values.push(upi_id || null);
    }
    if (bank_account_id !== undefined) {
      updates.push(`bank_account_id = $${paramIndex++}`);
      values.push(bank_account_id || null);
    }
    if (wallet_provider !== undefined) {
      updates.push(`wallet_provider = $${paramIndex++}`);
      values.push(wallet_provider || null);
    }
    if (account_details !== undefined) {
      updates.push(`account_details = $${paramIndex++}`);
      values.push(account_details || '{}');
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }
    if (is_default !== undefined) {
      updates.push(`is_default = $${paramIndex++}`);
      values.push(is_default);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(priority);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes || null);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, business_id);

    const method = await queryOne(
      `UPDATE payment_methods 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND business_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    if (!method) {
      return NextResponse.json(
        { error: 'Payment method not found or does not belong to business' },
        { status: 404 }
      );
    }

    return NextResponse.json({ method });
  } catch (error: any) {
    console.error('Error updating payment method:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/payment-methods
 * Delete a payment method
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const businessId = searchParams.get('business_id');

    if (!id || !businessId) {
      return NextResponse.json(
        { error: 'id and business_id are required' },
        { status: 400 }
      );
    }

    const result = await query(
      'DELETE FROM payment_methods WHERE id = $1 AND business_id = $2',
      [id, businessId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: 'Payment method not found or does not belong to business' },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: 'Payment method deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting payment method:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
