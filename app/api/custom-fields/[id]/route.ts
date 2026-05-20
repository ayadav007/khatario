import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { isValidFieldKey, normalizeDefinitionRow } from '@/lib/custom-fields';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import type { CustomFieldType } from '@/types/custom-fields';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const businessId = getBusinessIdFromRequest(request, body);
    const userId = getUserIdFromRequest(request, body);
    const id = params.id;

    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user_id are required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const existing = await queryOne(
      `SELECT * FROM custom_field_definitions WHERE id = $1 AND business_id = $2`,
      [id, businessId]
    );
    if (!existing) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (body.label !== undefined) {
      updates.push(`label = $${i++}`);
      values.push(String(body.label).trim());
    }
    if (body.field_type !== undefined) {
      const allowed: CustomFieldType[] = ['text', 'number', 'date', 'dropdown'];
      const t = allowed.includes(body.field_type) ? body.field_type : 'text';
      updates.push(`field_type = $${i++}`);
      values.push(t);
    }
    if (body.options !== undefined) {
      const optionList = Array.isArray(body.options)
        ? body.options.map((o: unknown) => String(o).trim()).filter(Boolean)
        : [];
      updates.push(`options = $${i++}::jsonb`);
      values.push(JSON.stringify(optionList));
    }
    if (body.is_required !== undefined) {
      updates.push(`is_required = $${i++}`);
      values.push(!!body.is_required);
    }
    if (body.sort_order !== undefined) {
      updates.push(`sort_order = $${i++}`);
      values.push(Number(body.sort_order));
    }
    if (body.field_key !== undefined) {
      const key = String(body.field_key).trim();
      if (!isValidFieldKey(key)) {
        return NextResponse.json({ error: 'Invalid field key' }, { status: 400 });
      }
      updates.push(`field_key = $${i++}`);
      values.push(key);
    }

    if (updates.length === 0) {
      return NextResponse.json({
        definition: normalizeDefinitionRow(existing as Record<string, unknown>),
      });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id, businessId);

    const row = await queryOne(
      `UPDATE custom_field_definitions SET ${updates.join(', ')}
       WHERE id = $${i++} AND business_id = $${i}
       RETURNING *`,
      values
    );

    return NextResponse.json({
      definition: normalizeDefinitionRow(row as Record<string, unknown>),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[custom-fields PATCH]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const id = params.id;

    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user_id are required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const result = await query(
      `DELETE FROM custom_field_definitions WHERE id = $1 AND business_id = $2`,
      [id, businessId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[custom-fields DELETE]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
