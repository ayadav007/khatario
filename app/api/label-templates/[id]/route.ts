import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  assertFeatureAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';

/**
 * GET    /api/label-templates/[id]  -> single template (system or owned)
 * PUT    /api/label-templates/[id]  -> update owned template (system blocked)
 * DELETE /api/label-templates/[id]  -> soft-delete owned template (system blocked)
 */

type FieldAlign = 'left' | 'center' | 'right';

const ALLOWED_FIELD_KEYS = new Set([
  'business_name',
  'brand',
  'product_name',
  'variant_name',
  'net_quantity',
  'barcode',
  'barcode_text',
  'price',
  'mrp',
  'hsn',
  'batch',
  'mfg',
  'expiry',
  'country_of_origin',
  'fssai',
]);
const ALLOWED_SYMBOLOGIES = new Set([
  'AUTO',
  'EAN13',
  'EAN8',
  'UPCA',
  'CODE128',
  'GS1_128',
  'QR',
  'CODE39',
]);

function validatePayload(
  payload: any
):
  | { ok: true; data: any }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object')
    return { ok: false, error: 'Body required' };
  if (!payload.name || typeof payload.name !== 'string')
    return { ok: false, error: 'name is required' };
  if (payload.format !== 'A4_SHEET' && payload.format !== 'ROLL')
    return { ok: false, error: 'format must be A4_SHEET or ROLL' };
  const w = Number(payload.width_mm);
  const h = Number(payload.height_mm);
  if (!Number.isFinite(w) || w <= 0 || w > 500)
    return { ok: false, error: 'width_mm must be between 1 and 500' };
  if (!Number.isFinite(h) || h <= 0 || h > 500)
    return { ok: false, error: 'height_mm must be between 1 and 500' };

  const symbology = payload.symbology || 'AUTO';
  if (!ALLOWED_SYMBOLOGIES.has(symbology))
    return { ok: false, error: `Invalid symbology: ${symbology}` };

  if (!Array.isArray(payload.fields))
    return { ok: false, error: 'fields must be an array' };
  const fields: any[] = [];
  for (const f of payload.fields) {
    if (!f || typeof f !== 'object')
      return { ok: false, error: 'Invalid field entry' };
    if (!ALLOWED_FIELD_KEYS.has(f.key))
      return { ok: false, error: `Unsupported field key: ${f.key}` };
    const fx = Number(f.x_mm),
      fy = Number(f.y_mm),
      fw = Number(f.w_mm),
      fh = Number(f.h_mm);
    if ([fx, fy, fw, fh].some((n) => !Number.isFinite(n)))
      return {
        ok: false,
        error: `Field ${f.key} requires numeric x/y/w/h`,
      };
    if (fw <= 0 || fh <= 0)
      return {
        ok: false,
        error: `Field ${f.key} must have positive size`,
      };
    const align: FieldAlign =
      f.align === 'center' || f.align === 'right' ? f.align : 'left';
    fields.push({
      key: f.key,
      x_mm: fx,
      y_mm: fy,
      w_mm: fw,
      h_mm: fh,
      font_size: Number.isFinite(Number(f.font_size))
        ? Number(f.font_size)
        : undefined,
      bold: !!f.bold,
      align,
      visible: f.visible !== false,
      prefix: f.prefix ?? null,
      suffix: f.suffix ?? null,
    });
  }

  return {
    ok: true,
    data: {
      name: payload.name.trim().slice(0, 200),
      description: payload.description?.toString().slice(0, 1000) ?? null,
      format: payload.format,
      width_mm: w,
      height_mm: h,
      columns: payload.columns != null ? Number(payload.columns) : null,
      rows_count: payload.rows_count != null ? Number(payload.rows_count) : null,
      gap_x_mm: Number(payload.gap_x_mm) || 0,
      gap_y_mm: Number(payload.gap_y_mm) || 0,
      margin_top_mm: Number(payload.margin_top_mm) || 0,
      margin_left_mm: Number(payload.margin_left_mm) || 0,
      symbology,
      fields,
      is_active: payload.is_active !== false,
    },
  };
}

export async function GET(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );

    const businessId = getBusinessIdFromRequest(request);
    if (!businessId)
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );

    try {
      await authorize(userId, 'items', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError)
        return error.toNextResponse();
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, 'barcode_label_printing');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError)
        return NextResponse.json(err.toResponse(), { status: 403 });
      throw err;
    }

    const tpl = await queryOne<any>(
      `SELECT * FROM label_templates
        WHERE id = $1
          AND (business_id IS NULL OR business_id = $2)`,
      [context.params.id, businessId]
    );
    if (!tpl)
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );

    return NextResponse.json({ template: tpl });
  } catch (error: any) {
    console.error('[GET /api/label-templates/[id]] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load template' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );

    const body = await request.json().catch(() => null);
    const businessId = getBusinessIdFromRequest(request, body);
    if (!businessId)
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );

    try {
      await authorize(userId, 'items', 'update');
    } catch (error) {
      if (error instanceof AuthorizationError)
        return error.toNextResponse();
      throw error;
    }

    try {
      await assertFeatureAccess(businessId, 'barcode_label_templates');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError)
        return NextResponse.json(err.toResponse(), { status: 403 });
      throw err;
    }

    const existing = await queryOne<any>(
      `SELECT id, business_id, is_system FROM label_templates WHERE id = $1`,
      [context.params.id]
    );
    if (!existing)
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    if (existing.is_system)
      return NextResponse.json(
        { error: 'System templates are read-only. Duplicate it first.' },
        { status: 403 }
      );
    if (existing.business_id !== businessId)
      return NextResponse.json(
        { error: 'Template belongs to a different business' },
        { status: 403 }
      );

    const check = validatePayload(body);
    if (!check.ok)
      return NextResponse.json({ error: check.error }, { status: 400 });
    const data = check.data;

    // Detect duplicate-name collision (excluding self).
    const dup = await queryOne<{ id: string }>(
      `SELECT id FROM label_templates
        WHERE business_id = $1
          AND LOWER(name) = LOWER($2)
          AND id <> $3`,
      [businessId, data.name, context.params.id]
    );
    if (dup)
      return NextResponse.json(
        { error: `Another template already uses the name "${data.name}".` },
        { status: 409 }
      );

    const updated = await queryOne<any>(
      `UPDATE label_templates
          SET name = $2,
              description = $3,
              format = $4,
              width_mm = $5,
              height_mm = $6,
              columns = $7,
              rows_count = $8,
              gap_x_mm = $9,
              gap_y_mm = $10,
              margin_top_mm = $11,
              margin_left_mm = $12,
              symbology = $13,
              fields = $14::jsonb,
              is_active = $15,
              updated_by = $16,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *`,
      [
        context.params.id,
        data.name,
        data.description,
        data.format,
        data.width_mm,
        data.height_mm,
        data.columns ?? null,
        data.rows_count ?? null,
        data.gap_x_mm ?? 0,
        data.gap_y_mm ?? 0,
        data.margin_top_mm ?? 0,
        data.margin_left_mm ?? 0,
        data.symbology,
        JSON.stringify(data.fields),
        data.is_active !== false,
        userId,
      ]
    );

    return NextResponse.json({ template: updated });
  } catch (error: any) {
    console.error('[PUT /api/label-templates/[id]] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to update template' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );

    const businessId = getBusinessIdFromRequest(request);
    if (!businessId)
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );

    try {
      await authorize(userId, 'items', 'delete');
    } catch (error) {
      if (error instanceof AuthorizationError)
        return error.toNextResponse();
      throw error;
    }

    const existing = await queryOne<any>(
      `SELECT id, business_id, is_system FROM label_templates WHERE id = $1`,
      [context.params.id]
    );
    if (!existing)
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    if (existing.is_system)
      return NextResponse.json(
        { error: 'System templates cannot be deleted.' },
        { status: 403 }
      );
    if (existing.business_id !== businessId)
      return NextResponse.json(
        { error: 'Template belongs to a different business' },
        { status: 403 }
      );

    await query(
      `UPDATE label_templates
          SET is_active = FALSE,
              updated_by = $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [context.params.id, userId]
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[DELETE /api/label-templates/[id]] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to delete template' },
      { status: 500 }
    );
  }
}
