import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { CommissionRule } from '@/types/database';

/**
 * PATCH /api/commission-rules/[id]
 * Update a commission rule
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ruleId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const body = await request.json();

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify rule belongs to business
    const existing = await queryOne(
      'SELECT id FROM commission_rules WHERE id = $1 AND business_id = $2',
      [ruleId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Commission rule not found' },
        { status: 404 }
      );
    }

    const {
      commission_type,
      commission_value,
      min_sale_amount,
      max_commission,
      applies_to_item_category,
      applies_to_customer_type,
      is_active,
      effective_from,
      effective_to,
    } = body;

    const updates: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (commission_type !== undefined) {
      updates.push(`commission_type = $${paramIndex++}`);
      queryParams.push(commission_type);
    }
    if (commission_value !== undefined) {
      updates.push(`commission_value = $${paramIndex++}`);
      queryParams.push(commission_value);
    }
    if (min_sale_amount !== undefined) {
      updates.push(`min_sale_amount = $${paramIndex++}`);
      queryParams.push(min_sale_amount);
    }
    if (max_commission !== undefined) {
      updates.push(`max_commission = $${paramIndex++}`);
      queryParams.push(max_commission || null);
    }
    if (applies_to_item_category !== undefined) {
      updates.push(`applies_to_item_category = $${paramIndex++}`);
      queryParams.push(applies_to_item_category || null);
    }
    if (applies_to_customer_type !== undefined) {
      updates.push(`applies_to_customer_type = $${paramIndex++}`);
      queryParams.push(applies_to_customer_type || null);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      queryParams.push(is_active);
    }
    if (effective_from !== undefined) {
      updates.push(`effective_from = $${paramIndex++}`);
      queryParams.push(effective_from || null);
    }
    if (effective_to !== undefined) {
      updates.push(`effective_to = $${paramIndex++}`);
      queryParams.push(effective_to || null);
    }

    if (updates.length > 0) {
      queryParams.push(ruleId);
      await query(
        `UPDATE commission_rules SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`,
        queryParams
      );
    }

    const updatedRule = await queryOne<CommissionRule>(
      'SELECT * FROM commission_rules WHERE id = $1',
      [ruleId]
    );

    return NextResponse.json({ rule: updatedRule });
  } catch (error: any) {
    console.error('Error updating commission rule:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/commission-rules/[id]
 * Delete a commission rule (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ruleId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify rule belongs to business
    const existing = await queryOne(
      'SELECT id FROM commission_rules WHERE id = $1 AND business_id = $2',
      [ruleId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Commission rule not found' },
        { status: 404 }
      );
    }

    // Soft delete
    await query(
      'UPDATE commission_rules SET is_active = false WHERE id = $1',
      [ruleId]
    );

    return NextResponse.json({ message: 'Commission rule deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting commission rule:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

