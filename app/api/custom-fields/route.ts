import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import {
  isValidFieldKey,
  normalizeDefinitionRow,
  slugifyFieldKey,
  CUSTOM_FIELD_LIMITS,
} from '@/lib/custom-fields';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import type { CustomFieldEntityType, CustomFieldType } from '@/types/custom-fields';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request) ?? searchParams.get('business_id');
    const entityType = searchParams.get('entity_type') as CustomFieldEntityType | null;
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const params: unknown[] = [businessId];
    let sql = `
      SELECT * FROM custom_field_definitions
      WHERE business_id = $1
    `;
    if (entityType) {
      sql += ` AND entity_type = $2`;
      params.push(entityType);
    }
    sql += ` ORDER BY entity_type, sort_order, label`;

    const rows = await queryRows(sql, params);
    return NextResponse.json({
      definitions: rows.map((r) => normalizeDefinitionRow(r as Record<string, unknown>)),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[custom-fields GET]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const businessId = getBusinessIdFromRequest(request, body);
    const userId = getUserIdFromRequest(request, body);
    const {
      entity_type,
      field_key: rawKey,
      label,
      field_type = 'text',
      options = [],
      is_required = false,
      sort_order,
    } = body;

    if (!businessId || !entity_type || !label) {
      return NextResponse.json(
        { error: 'business_id, entity_type, and label are required' },
        { status: 400 }
      );
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }
    if (entity_type !== 'item' && entity_type !== 'invoice') {
      return NextResponse.json({ error: 'entity_type must be item or invoice' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM custom_field_definitions
       WHERE business_id = $1 AND entity_type = $2`,
      [businessId, entity_type]
    );
    if (Number(countRow?.count || 0) >= CUSTOM_FIELD_LIMITS.maxPerEntity) {
      return NextResponse.json(
        {
          error: `Maximum ${CUSTOM_FIELD_LIMITS.maxPerEntity} custom fields per type`,
          code: 'CUSTOM_FIELD_LIMIT',
        },
        { status: 400 }
      );
    }

    let fieldKey = (rawKey && String(rawKey).trim()) || slugifyFieldKey(String(label));
    if (!isValidFieldKey(fieldKey)) {
      fieldKey = slugifyFieldKey(String(label));
    }
    if (!isValidFieldKey(fieldKey)) {
      return NextResponse.json({ error: 'Invalid field key' }, { status: 400 });
    }

    const allowedTypes: CustomFieldType[] = ['text', 'number', 'date', 'dropdown'];
    const type = allowedTypes.includes(field_type) ? field_type : 'text';
    const optionList =
      type === 'dropdown' && Array.isArray(options)
        ? options.map((o: unknown) => String(o).trim()).filter(Boolean)
        : [];

    let order = typeof sort_order === 'number' ? sort_order : undefined;
    if (order === undefined) {
      const maxRow = await queryOne<{ max: number | null }>(
        `SELECT MAX(sort_order) AS max FROM custom_field_definitions
         WHERE business_id = $1 AND entity_type = $2`,
        [businessId, entity_type]
      );
      order = (maxRow?.max ?? -1) + 1;
    }

    const row = await queryOne(
      `INSERT INTO custom_field_definitions (
        business_id, entity_type, field_key, label, field_type, options, is_required, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      RETURNING *`,
      [
        businessId,
        entity_type,
        fieldKey,
        String(label).trim(),
        type,
        JSON.stringify(optionList),
        !!is_required,
        order,
      ]
    );

    if (!row) {
      return NextResponse.json({ error: 'Failed to create field' }, { status: 500 });
    }

    return NextResponse.json({
      definition: normalizeDefinitionRow(row as Record<string, unknown>),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('uq_custom_field_definitions')) {
      return NextResponse.json({ error: 'A field with this key already exists' }, { status: 409 });
    }
    console.error('[custom-fields POST]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
